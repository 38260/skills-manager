// 后端进度事件验证：监听 SSE，确认 install-progress 带 percent / index / total。
import net from "node:net";
import { spawn } from "node:child_process";

const REPO = "file:///tmp/git-fixture";
const DIR = "/tmp/verify-home/.skills-manager";
const HOME = "/tmp/verify-home";
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

for (;;) {
  try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* 等启动 */ }
  await sleep(100);
}
console.log("服务就绪\n");

const events = [];
const controller = new AbortController();
void (async () => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/events`, { signal: controller.signal });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop();
      for (const part of parts) {
        if (!part.includes("install-progress")) continue;
        const dataLine = part.split("\n").find(l => l.startsWith("data:"));
        if (!dataLine) continue;
        try { events.push(JSON.parse(dataLine.slice(5).trim())); } catch { /* 忽略 */ }
      }
    }
  } catch { /* 结束 */ }
})();

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

console.log("--- preview_git_install ---");
const preview = await call("preview_git_install", { repoUrl: REPO });
console.log(`预览到 ${preview.skills.length} 个技能: ${preview.skills.map(s => s.name).join(", ")}`);

console.log("\n--- confirm_git_install ---");
await call("confirm_git_install", {
  repoUrl: REPO,
  tempDir: preview.temp_dir,
  items: preview.skills.map(s => ({ rel_path: s.rel_path, name: s.name })),
});
await sleep(600);

console.log("\n收到的 install-progress 事件:");
for (const e of events) {
  const bits = [`phase=${e.phase}`];
  if (e.percent != null) bits.push(`percent=${e.percent}`);
  if (e.index != null) bits.push(`index=${e.index}/${e.total}`);
  if (e.name) bits.push(`name=${e.name}`);
  console.log("  " + bits.join("  "));
}

const hasInstalling = events.some(e => e.phase === "installing" && e.index != null && e.total != null);
const hasDone = events.some(e => e.phase === "done");
console.log(`\n逐项进度(index/total): ${hasInstalling}  完成事件: ${hasDone}`);

const installed = await call("get_managed_skills");
console.log(`安装后技能数: ${installed.length}`);

controller.abort();
server.kill();
await sleep(400);
process.exit(0);
