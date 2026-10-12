import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { UsageStore, defaultSources } from "./store.mjs";

const canonical = filename => {
  try { filename = fs.realpathSync(filename); } catch { /* 未部署或已卸载路径仍可用于精确匹配。 */ }
  return filename.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
};

// 匹配索引：把每个技能的 canonical 路径在一次请求内只算一遍。
// 旧实现按「每条事件 × 每个技能」调用 canonical()（realpathSync），
// 调用记录一多就形成数万次文件系统调用的风暴
// （实测 174 条记录 × 53 个技能 ≈ 750ms，且随记录数线性恶化）。
// 索引按请求构建，不做跨请求缓存：路径可能被重链/卸载，每次请求现算最稳。
function buildSkillIndex(skills) {
  return skills.map(skill => ({
    id: skill.id,
    name: skill.name,
    display_name: skill.display_name,
    basename: path.basename(skill.central_path),
    central: canonical(skill.central_path),
    targets: skill.targets.map(target => ({ tool: target.tool, path: canonical(target.target_path) })),
  }));
}

// 与旧 matchManagedSkill 语义逐条等价，只是路径比较全部走预计算索引。
function matchEvent(event, index, tools) {
  const scope = event.project ? canonical(event.project) : null;
  const exact = event.skillPath ? canonical(event.skillPath).replace(/\/skill\.md$/i, "") : null;
  const candidates = index.filter(skill => {
    const targets = skill.targets.filter(target => target.tool === event.tool);
    if (exact) return skill.central === exact || targets.some(target => target.path === exact);
    if (skill.name !== event.skillName && skill.basename !== event.skillName) return false;
    const globalRoot = tools.find(tool => tool.key === event.tool)?.skills_dir;
    const globalRootPath = globalRoot ? canonical(globalRoot) : null;
    return targets.some(target => (scope && target.path.startsWith(`${scope}/`))
      || (globalRootPath && target.path.startsWith(`${globalRootPath}/`)));
  });
  return candidates.length === 1 ? candidates[0].id : null;
}

// 与 matchEvent 相同，但附带「统计口径」的名称兜底（唯一名称时接受名称匹配）。
function matchUsageEvent(event, index, tools) {
  const strict = matchEvent(event, index, tools);
  if (strict) return strict;
  const name = String(event.skillName ?? "").trim();
  if (!name) return null;
  const candidates = index.filter(skill => skill.name === name || skill.display_name === name || skill.basename === name);
  return candidates.length === 1 ? candidates[0].id : null;
}

export function matchManagedSkill(event, skills, tools = []) {
  return matchEvent(event, buildSkillIndex(skills), tools);
}

/**
 * 调用统计用的技能归属：先按严格规则（技能路径／部署位置）匹配；
 * 没有可验证路径时退回按技能名匹配，但同名技能不猜测归属。
 * 与 matchManagedSkill 的区别是「统计口径」与「记录溯源」不同：
 * 记录列表里的关联要能逐条追溯，所以只认可验证路径；统计需要一个尽量完整的总数，
 * 因此在名称唯一时接受名称匹配，避免大量记录因为日志里没有技能路径而全部算成"从未使用"。
 */
export function matchUsageSkill(event, skills, tools = []) {
  return matchUsageEvent(event, buildSkillIndex(skills), tools);
}

export class ActivityService {
  constructor({ directory, home, env, emit = () => {}, skills = () => [], tools = () => [], interval = 60000 }) {
    this.directory = directory; this.emit = emit; this.skills = skills; this.tools = tools;
    this.store = new UsageStore(directory); this.store.initialize(defaultSources(home, env));
    this.store.db.prepare("UPDATE sources SET state='idle' WHERE state='scanning'").run();
    this.worker = null; this.closed = false; this.signal = null;
    this.commands = {
      get_skill_activity: { call: args => {
        const result = this.store.query(args);
        // 索引只建一次：旧实现对每条事件都全量重算 canonical，接口耗时随记录数线性恶化。
        const index = buildSkillIndex(this.skills());
        const tools = this.tools();
        return { ...result, items: result.items.map(event => ({
          ...event,
          managedSkillId: matchEvent(event, index, tools),
          // 严格匹配（技能路径 / 部署位置）对不上时的弱兜底：按「技能名在库里唯一」再认一次，
          // 与调用统计同一口径。界面据此仍能跳到技能详情，但会注明是「按技能名匹配」，
          // 不改变 managedSkillId 可逐条追溯的语义。
          usageSkillId: matchUsageEvent(event, index, tools),
        })) };
      } },
      get_skill_activity_sources: { call: () => ({ sources: this.store.sources(), running: !!this.worker }) },
      // 每个已纳管技能的调用统计：总次数与最后使用时间；仅请求（未确认使用）不计入。
      get_skill_usage: { call: () => {
        // 索引只建一次：旧实现逐行全量重算 canonical，174 条记录就要 750ms。
        const index = buildSkillIndex(this.skills());
        const tools = this.tools();
        const rows = this.store.db.prepare("SELECT tool,skillName,skillPath,project,timestamp FROM events WHERE kind<>'request'").all();
        const usage = {};
        for (const row of rows) {
          const id = matchUsageEvent(row, index, tools);
          if (!id) continue;
          const entry = usage[id] ?? (usage[id] = { count: 0, lastUsedAt: null });
          entry.count += 1;
          if (Number.isSafeInteger(row.timestamp) && (entry.lastUsedAt === null || row.timestamp > entry.lastUsedAt)) entry.lastUsedAt = row.timestamp;
        }
        return usage;
      } },
      configure_skill_activity_source: { call: args => {
        if (this.worker) throw new Error("请先停止扫描，再修改来源");
        this.store.configure(args.tool, args.path, args.enabled); this.emit("skill-activity-changed");
      } },
      scan_skill_activity: { call: () => this.scan() },
      cancel_skill_activity_scan: { call: () => { if (this.signal) Atomics.store(this.signal, 0, 1); return { running: !!this.worker }; } },
    };
    if (interval) {
      this.initial = setTimeout(() => this.scan(), 1000); this.initial.unref();
      this.timer = setInterval(() => this.scan(), interval); this.timer.unref();
    }
  }
  scan() {
    if (this.closed || this.worker) return { running: !!this.worker };
    this.signal = new Int32Array(new SharedArrayBuffer(4));
    const worker = new Worker(new URL("./worker.mjs", import.meta.url), { workerData: { directory: this.directory, signal: this.signal.buffer } });
    this.worker = worker;
    let lastNotify = 0;
    worker.on("message", message => {
      if (message.type !== "progress" || Date.now() - lastNotify > 250) {
        lastNotify = Date.now(); this.emit("skill-activity-changed");
      }
    });
    worker.on("error", () => {
      this.store.db.prepare("UPDATE sources SET state='error',detail='扫描进程异常结束，历史记录已保留' WHERE state='scanning'").run();
    });
    worker.on("exit", () => {
      this.worker = null; this.signal = null;
      if (!this.closed) this.emit("skill-activity-changed");
    });
    return { running: true };
  }
  async close() {
    this.closed = true; clearInterval(this.timer); clearTimeout(this.initial);
    if (this.worker) await this.worker.terminate();
    this.store.close();
  }
}
