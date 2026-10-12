// 启动一次真实服务，让 sources 表补上 workbuddy_ai（initialize 用 INSERT OR IGNORE）。
// 查到结果后立即退出，不等后台扫描跑完。
import net from "node:net";
import { spawn } from "node:child_process";

const DIR = "C:/Users/luckyzyb/.skills-manager";
const HOME = "C:/Users/luckyzyb";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => {
  const p = net.createServer();
  p.listen(0, "127.0.0.1", () => { const { port } = p.address(); p.close(() => res(port)); });
  p.on("error", rej);
});

const port = await freePort();
const server = spawn(process.execPath,
  ["backend/server.mjs", "--port", String(port), "--directory", DIR, "--home", HOME],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let log = "";
server.stdout.on("data", c => log += c);
server.stderr.on("data", c => log += c);

try {
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* 等 */ }
    await sleep(120);
  }
  const res = await fetch(`http://127.0.0.1:${port}/api/invoke/get_skill_activity_sources`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-skills-manager-client": "webview" },
    body: "{}",
  });
  const json = await res.json();
  const sources = json.data.sources;
  console.log(`来源数: ${sources.length}`);
  for (const s of sources) console.log(`  ${s.tool.padEnd(13)} ${s.path}`);
  const added = sources.some(s => s.tool === "workbuddy_ai");
  console.log(`\nworkbuddy_ai 已登记: ${added}`);
} catch (error) {
  console.error("失败:", error.message);
  process.exitCode = 1;
} finally {
  server.kill();
  await sleep(300);
  process.exit(process.exitCode ?? 0);
}
