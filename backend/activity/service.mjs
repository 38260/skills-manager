import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { UsageStore, defaultSources } from "./store.mjs";

const canonical = filename => {
  try { filename = fs.realpathSync(filename); } catch { /* 未部署或已卸载路径仍可用于精确匹配。 */ }
  return filename.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
};
export function matchManagedSkill(event, skills, tools = []) {
  const scope = event.project ? canonical(event.project) : null;
  const exact = event.skillPath ? canonical(event.skillPath).replace(/\/skill\.md$/i, "") : null;
  const candidates = skills.filter(skill => {
    const targets = skill.targets.filter(target => target.tool === event.tool);
    if (exact) return canonical(skill.central_path) === exact || targets.some(target => canonical(target.target_path) === exact);
    if (skill.name !== event.skillName && path.basename(skill.central_path) !== event.skillName) return false;
    const globalRoot = tools.find(tool => tool.key === event.tool)?.skills_dir;
    return targets.some(target => (scope && canonical(target.target_path).startsWith(`${scope}/`))
      || (globalRoot && canonical(target.target_path).startsWith(`${canonical(globalRoot)}/`)));
  });
  return candidates.length === 1 ? candidates[0].id : null;
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
        const skills = this.skills();
        const tools = this.tools();
        return { ...result, items: result.items.map(event => ({ ...event, managedSkillId: matchManagedSkill(event, skills, tools) })) };
      } },
      get_skill_activity_sources: { call: () => ({ sources: this.store.sources(), running: !!this.worker }) },
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
