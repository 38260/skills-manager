// 复现 codex-ppt 的「检查失败」：调用 check_skill_update，观察是否报 EPERM。
import net from "node:net";
import os from "node:os";
import { spawn } from "node:child_process";

const DIR = path.join(os.homedir(), ".skills-manager");
const HOME = path.resolve("output/check-repro/data");
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
    await sleep(150);
  }
  const call = async (name, params = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/invoke/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-skills-manager-client": "webview" },
      body: JSON.stringify(params ?? {}),
    });
    return await res.json();
  };

  const skills = (await call("get_managed_skills")).data;
  const target = skills.find(s => s.name === "codex-ppt");
  console.log("目标技能:", target.name, "| 当前状态:", target.update_status);

  for (let i = 1; i <= 3; i++) {
    const r = await call("check_skill_update", { skillId: target.id });
    const after = (await call("get_managed_skills")).data.find(s => s.name === "codex-ppt");
    console.log(`\n第 ${i} 次检查: ok=${r.ok}`);
    if (!r.ok) console.log("  错误:", String(r.message).slice(0, 200));
    console.log("  检查后状态:", after.update_status, "| remote_revision:", (after.remote_revision || "").slice(0, 12));
    await sleep(500);
  }
} catch (error) {
  console.error("中断:", error.message);
} finally {
  server.kill();
  await sleep(400);
  process.exit(0);
}
