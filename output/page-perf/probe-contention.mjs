// 「页面加载慢」的机理验证：启动后 3 秒自动跑的那轮检查更新，会不会把同时打开的页面拖住。
//
// 做法：先不 await 地起 check_all_skill_updates（模拟前端启动后的自动轮次），
// 200ms 后并发打出一页要用的那几个接口，量「页面要的数据全部回来」用了多久。
// 对照组：等检查跑完、系统安静下来，再打同一组接口。
//
// 旧代码从 git HEAD 取出放在 output/page-perf/old-backend（不碰工作区），
// 所以同一脚本可以跑出 before / after：
//   用法：node output/page-perf/probe-contention.mjs old|new
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

const which = process.argv[2] === "old" ? "old" : "new";
const backendEntry = which === "old"
  ? path.resolve("output/page-perf/old-backend/server.mjs")
  : path.resolve("backend/server.mjs");
if (!fs.existsSync(backendEntry)) throw new Error(`找不到后端入口：${backendEntry}（old 请先按 README 里的命令从 HEAD 导出）`);

const REAL = path.join(os.homedir(), ".skills-manager");
const REAL_HOME = os.homedir();
const root = path.resolve("output/page-perf");
const runTag = new Date().toISOString().replace(/[:.]/g, "-");
const home = path.join(root, "data", `contention-${which}-${runTag}`);
const dir = path.join(home, ".skills-manager");
fs.mkdirSync(dir, { recursive: true });

// 库只复制元数据 + 数据库：DB 里的 central_path 是绝对路径，仍指向真实技能目录（只读）。
for (const name of ["skills-manager.db", "skills-manager.db-wal", "skills-manager.db-shm", ".secret.key", "repo-config.json"]) {
  if (fs.existsSync(path.join(REAL, name))) fs.cpSync(path.join(REAL, name), path.join(dir, name));
}
fs.mkdirSync(path.join(dir, "skills"), { recursive: true });
fs.cpSync(path.join(REAL, "skills", ".skills-manager"), path.join(dir, "skills", ".skills-manager"), { recursive: true });
if (fs.existsSync(path.join(REAL, "install-manifests"))) fs.cpSync(path.join(REAL, "install-manifests"), path.join(dir, "install-manifests"), { recursive: true });

// 让所有技能都「过期」，逼出完整的检查循环（否则新代码会走新鲜期直接跳过，测不到竞争）。
{
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(dir, "skills-manager.db"));
  db.prepare("UPDATE skills SET last_checked_at=0").run();
  db.close();
}

// 用 junction 把真实 home 里存在的 Agent 检测目录挂进隔离 home：
// 工具检测、各 Agent 的 skills 目录、调用记录来源都与真实环境一致，写入仍只落在隔离目录。
const agents = JSON.parse(fs.readFileSync(new URL("../../backend/agents.json", import.meta.url), "utf8"));
const detectDirs = [...new Set(agents.map(item => item.relative_detect_dir).filter(Boolean))];
const linked = [];
for (const relative of detectDirs) {
  const target = path.join(REAL_HOME, relative);
  const link = path.join(home, relative);
  if (!fs.existsSync(target) || fs.existsSync(link)) continue;
  try { fs.symlinkSync(target, link, "junction"); linked.push(relative); } catch { /* 权限不允许就跳过 */ }
}
fs.mkdirSync(path.join(home, ".skills-manager-activity"), { recursive: true });
fs.cpSync(path.join(REAL_HOME, ".skills-manager-activity"), path.join(home, ".skills-manager-activity"), { recursive: true });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  probe.on("error", reject);
});

const port = await freePort();
const server = spawn(process.execPath, [backendEntry, "--port", String(port), "--directory", dir, "--home", home],
  { cwd: path.dirname(backendEntry), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let log = "";
server.stdout.on("data", chunk => { log += chunk; });
server.stderr.on("data", chunk => { log += chunk; });

const call = async (name, params = {}) => {
  const started = performance.now();
  const response = await fetch(`http://127.0.0.1:${port}/api/invoke/${name}`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-skills-manager-client": "webview" }, body: JSON.stringify(params),
  });
  const json = await response.json();
  return { ms: Math.round(performance.now() - started), ok: json.ok };
};

// 技能库页首屏要的那几个接口（AppContext 的启动四件套 + MySkills 自己的几个）
const PAGE_CALLS = [
  ["get_preset_skill_order", {}],
  ["git_backup_pending_conflicts", {}],
  ["get_skill_categories", {}],
  ["get_skill_usage", {}],
  ["git_backup_status", {}],
  ["get_skill_activity", { page: 1, pageSize: 50 }],
  ["get_skill_activity_sources", {}],
];

try {
  const deadline = Date.now() + 20000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* 等 */ }
    if (Date.now() > deadline) throw new Error(`服务未就绪：${log}`);
    await sleep(150);
  }
  await call("get_managed_skills");

  const measurePage = async label => {
    const started = performance.now();
    const results = await Promise.all(PAGE_CALLS.map(([name, params]) => call(name, params)));
    const wall = Math.round(performance.now() - started);
    const slowest = results.map((item, index) => ({ name: PAGE_CALLS[index][0], ms: item.ms })).sort((a, b) => b.ms - a.ms)[0];
    console.log(`  ${label}：整页数据到位 ${String(wall).padStart(5)}ms（最慢 ${slowest.name} ${slowest.ms}ms）`);
    return wall;
  };

  console.log(`\n=== ${which === "old" ? "改动前（git HEAD 的 backend）" : "改动后（当前 backend）"} ===`);
  console.log(`夹具：${linked.length} 个 Agent 检测目录已挂载，所有技能标记为已过期`);
  console.log("");

  console.log("① 安静状态下打开页面（对照组）");
  const quiet = await measurePage("技能库 + 调用记录");
  await sleep(300);

  console.log("\n② 启动后自动检查更新的同时打开页面（真实场景）");
  const checkStarted = performance.now();
  const checkPromise = call("check_all_skill_updates", { force: false });
  await sleep(200);
  const contended = await measurePage("技能库 + 调用记录");
  const check = await checkPromise;
  const checkMs = Math.round(performance.now() - checkStarted);
  console.log(`  （同一时刻的自动检查用了 ${checkMs}ms，ok=${check.ok}）`);

  console.log(`\n结论：自动检查进行中打开页面 ${contended}ms ／ 安静状态 ${quiet}ms`);
} finally {
  try { server.kill(); } catch { /* ignore */ }
  await sleep(300);
}
