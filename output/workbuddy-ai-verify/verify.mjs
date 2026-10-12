// 验证新增的 workbuddy_ai 来源：注册、扫描、解析出 Skill 调用。
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const BASE = path.resolve("output/workbuddy-ai-verify/data");
const HOME = BASE;
const DIR = `${BASE}/.skills-manager`;
// 含 Skill 调用的真实日志样本（来自 WorkBuddy AI 的当前项目会话）。
// 需要一份含 Skill 调用的真实样本：用环境变量指定，或默认取本机 WorkBuddy AI 的项目目录。
const SAMPLE = process.env.WORKBUDDY_AI_SAMPLE || path.join(os.homedir(), ".workbuddy-ai", "projects");

const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => {
  const p = net.createServer();
  p.listen(0, "127.0.0.1", () => { const { port } = p.address(); p.close(() => res(port)); });
  p.on("error", rej);
});

fs.rmSync(BASE, { recursive: true, force: true });
// 只放 workbuddy_ai 的样本，其他来源留空以缩短扫描时间。
const projDir = path.join(BASE, ".workbuddy-ai", "projects", "d-AIWorkSpace-Codex-SkillManager");
fs.mkdirSync(projDir, { recursive: true });
fs.copyFileSync(SAMPLE, path.join(projDir, path.basename(SAMPLE)));
console.log("样本已放入:", path.relative(BASE, path.join(projDir, path.basename(SAMPLE))));

const results = [];
const record = (name, value) => { results.push({ name, value }); console.log(`· ${name}: ${JSON.stringify(value)}`); };

const port = await freePort();
const server = spawn(process.execPath,
  ["backend/server.mjs", "--port", String(port), "--directory", DIR, "--home", HOME],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let log = "";
server.stdout.on("data", c => log += c);
server.stderr.on("data", c => log += c);

try {
  const deadline = Date.now() + 20000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* 等 */ }
    if (Date.now() > deadline) throw new Error("服务未就绪: " + log);
    await sleep(150);
  }

  const call = async (name, params = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/invoke/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-skills-manager-client": "webview" },
      body: JSON.stringify(params ?? {}),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(`${name}: ${json.message}`);
    return json.data;
  };

  const sources = (await call("get_skill_activity_sources")).sources;
  record("来源数量", sources.length);
  record("来源列表", sources.map(s => s.tool));
  record("workbuddy_ai 路径", sources.find(s => s.tool === "workbuddy_ai")?.path ?? null);

  console.log("\n触发扫描...");
  await call("scan_skill_activity");
  // 等扫描 worker 结束
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const status = await call("get_skill_activity_sources");
    if (!status.running) break;
  }
  const after = (await call("get_skill_activity_sources")).sources;
  record("扫描后 workbuddy_ai 状态", after.find(s => s.tool === "workbuddy_ai")?.state ?? null);
  record("扫描文件数", after.find(s => s.tool === "workbuddy_ai")?.files ?? null);

  const activity = await call("get_skill_activity", { page: 1, pageSize: 20 });
  record("总记录数", activity.total);
  const wbai = activity.items.filter(i => i.tool === "workbuddy_ai");
  record("workbuddy_ai 记录数", wbai.length);
  record("解析出的 Skill 调用", wbai.map(i => ({ skillName: i.skillName, kind: i.kind, status: i.status })));

  fs.writeFileSync("output/workbuddy-ai-verify/report.json", JSON.stringify(results, null, 2));
  console.log("\n结果已写入 output/workbuddy-ai-verify/report.json");
} catch (error) {
  console.error("验证中断:", error.message);
  fs.writeFileSync("output/workbuddy-ai-verify/report.json", JSON.stringify({ error: error.message, results }, null, 2));
  process.exitCode = 1;
} finally {
  server.kill();
  await sleep(400);
  process.exit(process.exitCode ?? 0);
}
