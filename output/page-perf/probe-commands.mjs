// 各页面首屏真正依赖的「重」命令逐一计时（隔离夹具：DB 副本 + junction 挂载真实 Agent 目录）。
// 目的：找出哪一个命令让某个页面显得慢，而不是靠猜。
// 用法：node output/page-perf/probe-commands.mjs
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

const REAL = path.join(os.homedir(), ".skills-manager");
const REAL_HOME = os.homedir();
const root = path.resolve("output/page-perf");
const runTag = new Date().toISOString().replace(/[:.]/g, "-");
const home = path.join(root, "data", `commands-${runTag}`);
const dir = path.join(home, ".skills-manager");
fs.mkdirSync(dir, { recursive: true });
for (const name of ["skills-manager.db", "skills-manager.db-wal", "skills-manager.db-shm", ".secret.key", "repo-config.json"]) {
  if (fs.existsSync(path.join(REAL, name))) fs.cpSync(path.join(REAL, name), path.join(dir, name));
}
fs.mkdirSync(path.join(dir, "skills"), { recursive: true });
fs.cpSync(path.join(REAL, "skills", ".skills-manager"), path.join(dir, "skills", ".skills-manager"), { recursive: true });
if (fs.existsSync(path.join(REAL, "install-manifests"))) fs.cpSync(path.join(REAL, "install-manifests"), path.join(dir, "install-manifests"), { recursive: true });

const agents = JSON.parse(fs.readFileSync(path.resolve("backend/agents.json"), "utf8"));
for (const relative of [...new Set(agents.map(item => item.relative_detect_dir).filter(Boolean))]) {
  const target = path.join(REAL_HOME, relative);
  const link = path.join(home, relative);
  if (!fs.existsSync(target) || fs.existsSync(link)) continue;
  try { fs.symlinkSync(target, link, "junction"); } catch { /* 跳过 */ }
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
  return { ms: Math.round(performance.now() - started), ok: json.ok, data: json.data, message: json.message };
};
const show = async (label, name, params = {}) => {
  const result = await call(name, params);
  const size = JSON.stringify(result.data ?? "").length;
  console.log(`  ${label.padEnd(34)} ${String(result.ms).padStart(6)}ms  ${result.ok ? "" : "✗ " + String(result.message).slice(0, 70)}  (${(size / 1024).toFixed(1)}KB)`);
  return result;
};

try {
  const deadline = Date.now() + 20000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* 等 */ }
    if (Date.now() > deadline) throw new Error(`服务未就绪：${log}`);
    await sleep(150);
  }

  const skills = (await call("get_managed_skills")).data;
  const tools = (await call("get_tool_status")).data;
  const installed = tools.filter(item => item.installed);
  console.log(`技能 ${skills.length} 个；已安装 Agent ${installed.length} 个（前几个：${installed.slice(0, 4).map(t => t.key).join(", ")}）\n`);

  console.log("【通用 / Dashboard】");
  await show("get_managed_skills", "get_managed_skills");
  await show("get_skill_activity(首页动态)", "get_skill_activity", { page: 1, pageSize: 14 });
  await show("get_projects(部署统计)", "get_projects");

  console.log("\n【调用记录】");
  await show("get_skill_activity(50/页)", "get_skill_activity", { page: 1, pageSize: 50 });
  await show("get_skill_activity(筛 failed)", "get_skill_activity", { page: 1, pageSize: 50, status: "failed" });
  await show("get_skill_activity_sources", "get_skill_activity_sources");

  console.log("\n【技能库】");
  await show("get_skill_usage(勾选统计)", "get_skill_usage");
  await show("get_skill_categories", "get_skill_categories");
  await show("get_all_tags", "get_all_tags");
  await show("get_preset_skill_order", "get_preset_skill_order", { presetId: skills[0]?.preset_ids?.[0] ?? "" });

  // 技能详情：按目录大小取最大的几个（files() 是递归 + 逐个 stat）
  const sizes = skills.map(skill => {
    let total = 0;
    const walk = location => {
      let entries = [];
      try { entries = fs.readdirSync(location, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        const full = path.join(location, entry.name);
        if (entry.isDirectory()) walk(full);
        else { try { total += fs.statSync(full).size; } catch { /* ignore */ } }
      }
    };
    walk(skill.central_path);
    return { skill, total };
  }).sort((a, b) => b.total - a.total);

  console.log("\n【技能详情（按体积取最大的 3 个技能）】");
  for (const { skill, total } of sizes.slice(0, 3)) {
    console.log(`  — ${skill.name}（${(total / 1048576).toFixed(2)}MB）`);
    await show("  get_skill_document", "get_skill_document", { skillId: skill.id });
    await show("  get_skill_files", "get_skill_files", { skillId: skill.id });
    await show("  get_skill_source_diff", "get_skill_source_diff", { skillId: skill.id });
  }

  console.log("\n【全局工作区（逐个 Agent 列技能，各调用两次看冷/热）】");
  for (const tool of installed) {
    const cold = await call("get_global_local_skills", { agent: tool.key });
    const warm = await call("get_global_local_skills", { agent: tool.key });
    console.log(`  ${tool.key.padEnd(20)} 首次 ${String(cold.ms).padStart(6)}ms   再次 ${String(warm.ms).padStart(6)}ms  ${cold.ok ? "" : "✗ " + String(cold.message).slice(0, 60)}`);
  }

  console.log("\n【安装页】");
  await show("fetch_leaderboard", "fetch_leaderboard");
} finally {
  try { server.kill(); } catch { /* ignore */ }
  await sleep(300);
}
