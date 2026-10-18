// 量化「检查更新」这条链路的耗时构成（隔离库副本，不写用户数据）。
// 关键点：52 个技能是 local（无远程）、只有 1 个 git；check(id) 内部调用 store.skill(id)
// 会重建整张技能表，于是「逐个检查」变成 O(N²)。
// 用法：node output/page-perf/measure-check.mjs
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

const REAL = path.join(os.homedir(), ".skills-manager");
const root = path.resolve("output/page-perf");
const runTag = new Date().toISOString().replace(/[:.]/g, "-");
const home = path.join(root, "data", `check-${runTag}`);
const dir = path.join(home, ".skills-manager");
fs.mkdirSync(dir, { recursive: true });
// 只复制库的元数据与数据库：DB 里存的 central_path 是绝对路径，仍指向真实技能目录（只读）。
fs.cpSync(path.join(REAL, "skills-manager.db"), path.join(dir, "skills-manager.db"));
for (const extra of [".secret.key", "repo-config.json", "skills-manager.db-wal", "skills-manager.db-shm"]) {
  if (fs.existsSync(path.join(REAL, extra))) fs.cpSync(path.join(REAL, extra), path.join(dir, extra));
}
fs.mkdirSync(path.join(dir, "skills"), { recursive: true });
fs.cpSync(path.join(REAL, "skills", ".skills-manager"), path.join(dir, "skills", ".skills-manager"), { recursive: true });
if (fs.existsSync(path.join(REAL, "install-manifests"))) fs.cpSync(path.join(REAL, "install-manifests"), path.join(dir, "install-manifests"), { recursive: true });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  probe.on("error", reject);
});

const port = await freePort();
const server = spawn(process.execPath, ["backend/server.mjs", "--port", String(port), "--directory", dir, "--home", home],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let log = "";
server.stdout.on("data", chunk => { log += chunk; });
server.stderr.on("data", chunk => { log += chunk; });

const call = async (name, params = {}) => {
  const started = performance.now();
  const response = await fetch(`http://127.0.0.1:${port}/api/invoke/${name}`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-skills-manager-client": "webview" }, body: JSON.stringify(params),
  });
  const json = await response.json();
  return { ms: Math.round(performance.now() - started), ok: json.ok, message: json.message, data: json.data };
};

try {
  const deadline = Date.now() + 20000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* 等 */ }
    if (Date.now() > deadline) throw new Error(`服务未就绪：${log}`);
    await sleep(150);
  }

  const skills = (await call("get_managed_skills")).data;
  const locals = skills.filter(item => item.source_type === "local").slice(0, 3);
  const git = skills.find(item => item.source_type === "git");
  console.log(`技能总数 ${skills.length}：local ${skills.filter(s => s.source_type === "local").length} / git ${skills.filter(s => s.source_type === "git").length}`);
  console.log("");

  const baseline = await call("get_managed_skills");
  console.log(`基准 get_managed_skills（重建整张技能表）      ${baseline.ms}ms`);

  const single = await call("get_managed_skills");
  console.log(`再测一次（热）                                ${single.ms}ms`);
  console.log("");

  for (const skill of locals) {
    const result = await call("check_skill_update", { skillId: skill.id });
    console.log(`check_skill_update  local  ${skill.name.padEnd(28)} ${String(result.ms).padStart(6)}ms  ok=${result.ok}`);
  }

  // 52 个 local 技能逐个检查的总成本（把 git 技能排除在外，单看 O(N²) 这一项）
  const localIds = skills.filter(item => item.source_type === "local").map(item => item.id);
  const localStarted = performance.now();
  for (const id of localIds) await call("check_skill_update", { skillId: id });
  const localTotal = Math.round(performance.now() - localStarted);
  console.log(`\n${localIds.length} 个 local 技能逐个检查合计 ${localTotal}ms（平均 ${Math.round(localTotal / localIds.length)}ms/个）`);

  if (git) {
    console.log(`\ncheck_skill_update  git    ${git.name}（含 clone 远程）…`);
    const result = await call("check_skill_update", { skillId: git.id });
    console.log(`  → ${result.ms}ms  ok=${result.ok}  ${result.ok ? "" : String(result.message).slice(0, 90)}`);
  }

  console.log("\ncheck_all_skill_updates（前端启动后自动跑的那条，force 未传）…");
  const all = await call("check_all_skill_updates", { force: false });
  console.log(`  → ${all.ms}ms  ok=${all.ok}`);

  console.log("\ncheck_all_skill_updates（手动按钮，force=true：全部重查）…");
  const all2 = await call("check_all_skill_updates", { force: true });
  console.log(`  → ${all2.ms}ms  ok=${all2.ok}`);
} finally {
  try { server.kill(); } catch { /* ignore */ }
  await sleep(300);
}
