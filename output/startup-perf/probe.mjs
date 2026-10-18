// 启动耗时探针：在用户真实数据的副本上起后端，逐命令计时。
import net from "node:net";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const REAL = path.join(os.homedir(), ".skills-manager");
const REAL_ACT = path.join(os.homedir(), ".skills-manager-activity");
const STAGE = path.resolve("output/startup-perf/data");
const HOME = path.join(STAGE, "home");
const DIR = path.join(HOME, ".skills-manager");
const sleep = ms => new Promise(r => setTimeout(r, ms));

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
fs.cpSync(REAL, DIR, { recursive: true });
fs.mkdirSync(path.join(HOME, ".skills-manager-activity"), { recursive: true });
fs.cpSync(REAL_ACT, path.join(HOME, ".skills-manager-activity"), { recursive: true });

const freePort = () => new Promise((res, rej) => {
  const p = net.createServer();
  p.listen(0, "127.0.0.1", () => { const { port } = p.address(); p.close(() => res(port)); });
  p.on("error", rej);
});

const port = await freePort();
const t0 = performance.now();
const server = spawn(process.execPath,
  ["backend/server.mjs", "--port", String(port), "--directory", DIR, "--home", HOME],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let log = "";
server.stdout.on("data", c => log += c);
server.stderr.on("data", c => log += c);

let healthAt = null;
for (;;) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    if (res.ok) { healthAt = performance.now(); break; }
  } catch { /* 等 */ }
  await sleep(20);
}
console.log(`① 进程 spawn → /api/health 就绪：${Math.round(healthAt - t0)}ms`);

const call = async (name, params = {}) => {
  const started = performance.now();
  const res = await fetch(`http://127.0.0.1:${port}/api/invoke/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-skills-manager-client": "webview" },
    body: JSON.stringify(params ?? {}),
  });
  const json = await res.json();
  return { ms: performance.now() - started, ok: json.ok, size: JSON.stringify(json.data ?? "").length, data: json.data, message: json.message };
};

// 前端启动时 AppContext.refreshAppData() 并发拉的四个命令
const boot = ["get_presets", "get_tool_status", "get_managed_skills", "get_projects"];
console.log("\n② 启动四件套（并发，模拟 refreshAppData）：");
const bootStarted = performance.now();
const results = await Promise.all(boot.map(name => call(name)));
console.log(`   并发总耗时：${Math.round(performance.now() - bootStarted)}ms`);
boot.forEach((name, index) => {
  const r = results[index];
  console.log(`   ${name.padEnd(22)} ${r.ms.toFixed(0).padStart(6)}ms  ok=${r.ok}  payload=${(r.size / 1024).toFixed(1)}KB${r.ok ? "" : "  " + r.message}`);
});

console.log("\n③ 各页面首屏命令（串行，看单条耗时）：");
for (const [name, params] of [
  ["get_skill_activity", { page: 1, pageSize: 14 }],
  ["get_skill_usage", {}],
  ["get_skill_activity_sources", {}],
  ["get_all_tags", {}],
  ["get_skill_categories", {}],
  ["get_settings", { key: "text_size" }],
]) {
  const r = await call(name, params);
  console.log(`   ${name.padEnd(26)} ${r.ms.toFixed(0).padStart(6)}ms  ok=${r.ok}  payload=${(r.size / 1024).toFixed(1)}KB${r.ok ? "" : "  " + String(r.message).slice(0, 80)}`);
}

console.log("\n④ get_managed_skills 复测 ×3（看是否稳定）：");
for (let i = 1; i <= 3; i++) {
  const r = await call("get_managed_skills");
  console.log(`   #${i} ${r.ms.toFixed(0)}ms`);
}
console.log(`\n技能条数：${(await call("get_managed_skills")).data.length}`);

server.kill();
await sleep(300);
console.log("\n--- server 输出 ---\n" + log.trim().split("\n").slice(-8).join("\n"));
process.exit(0);
