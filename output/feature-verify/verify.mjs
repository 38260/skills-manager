// 验证：① 调用记录筛选默认收起 / 展开 / 条件保留；② Agent 移除与恢复。
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const BASE = "D:/AIWorkSpace/Codex/SkillManager/skills-manager/output/feature-verify/data";
const DIR = `${BASE}/.skills-manager`;
const HOME = BASE;
const OUT = "output/feature-verify";
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(BASE, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => {
  const p = net.createServer();
  p.listen(0, "127.0.0.1", () => { const { port } = p.address(); p.close(() => res(port)); });
  p.on("error", rej);
});

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(c => fs.existsSync(c));

const results = [];
const record = (name, value) => { results.push({ name, value }); console.log(`· ${name}: ${JSON.stringify(value)}`); };

const port = await freePort();
const debugPort = await freePort();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "feature-verify-"));
const server = spawn(process.execPath,
  ["backend/server.mjs", "--port", String(port), "--directory", DIR, "--home", HOME],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let log = "";
server.stdout.on("data", c => log += c);
server.stderr.on("data", c => log += c);

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

let chrome;
let ws;
try {
  const deadline = Date.now() + 20000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* 等 */ }
    if (Date.now() > deadline) throw new Error("服务未就绪: " + log);
    await sleep(150);
  }

  // ── 后端：Agent 移除 / 恢复 ──
  const before = (await call("get_tool_status")).length;
  await call("hide_tool", { key: "codex" });
  const afterHide = (await call("get_tool_status")).length;
  const hidden = await call("get_hidden_tools");
  record("移除后工具数变化", { before, afterHide, diff: before - afterHide });
  record("已移除列表", hidden.map(t => t.key));

  const stillEnabled = (await call("get_tool_status")).some(t => t.key === "codex");
  record("移除的 Agent 不再出现在工具列表", !stillEnabled);

  await call("restore_tool", { key: "codex" });
  const afterRestore = (await call("get_tool_status")).length;
  const hiddenAfter = await call("get_hidden_tools");
  record("恢复后工具数", { afterRestore, hiddenCount: hiddenAfter.length });

  // ── UI ──
  chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*", `--user-data-dir=${profile}`,
    "--window-size=1440,1000", "about:blank"], { stdio: "ignore" });

  let target = null;
  for (let i = 0; i < 160 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      target = list.find(t => t.type === "page" && t.webSocketDebuggerUrl);
    } catch { /* 等 */ }
    if (!target) await sleep(250);
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  if (ws.readyState !== 1) await new Promise(r => ws.addEventListener("open", r, { once: true }));
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", e => {
    const m = JSON.parse(e.data);
    const entry = pending.get(m.id);
    if (entry) { pending.delete(m.id); m.error ? entry.reject(new Error(JSON.stringify(m.error))) : entry.resolve(m.result); }
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params ?? {} }));
  });
  const evaluate = async (expression, awaitPromise = false) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result?.value;
  };
  const shoot = async name => {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(shot.data, "base64"));
    console.log(`  SHOT ${name}.png`);
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/skill-activity` });
  await sleep(2500);
  await evaluate(`localStorage.setItem('theme','light')`);
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/skill-activity` });
  await sleep(2500);
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('全新开始')); if (b) b.click(); return !!b; })()`);
  await sleep(700);

  const measure = `(() => {
    const form = document.querySelector('form');
    if (!form) return null;
    return { height: Math.round(form.getBoundingClientRect().height),
      labels: [...form.querySelectorAll('label')].length,
      hasMoreButton: !!([...form.querySelectorAll('button')].find(b => /更多筛选|收起筛选/.test(b.textContent))) };
  })()`;

  record("筛选（默认收起）", await evaluate(measure));
  await shoot("01_filter_collapsed");

  // 展开
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('form button')].find(x => x.textContent.includes('更多筛选'));
    if (b) b.click(); return !!b;
  })()`);
  await sleep(500);
  record("筛选（展开后）", await evaluate(measure));
  await shoot("02_filter_expanded");

  // 填一个条件（项目），收起，再展开，验证条件保留
  await evaluate(`(() => {
    const project = document.querySelector('form input[placeholder*="项目"]');
    if (!project) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(project, 'D:/demo/project');
    project.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(300);
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('form button')].find(x => x.textContent.includes('收起筛选'));
    if (b) b.click(); return !!b;
  })()`);
  await sleep(400);
  record("收起后仍显示条件数徽章", await evaluate(`(() => {
    const form = document.querySelector('form');
    const badge = [...form.querySelectorAll('span')].find(s => /^\\d+$/.test(s.textContent.trim()));
    return badge ? badge.textContent.trim() : null;
  })()`));

  await evaluate(`(() => {
    const b = [...document.querySelectorAll('form button')].find(x => x.textContent.includes('更多筛选'));
    if (b) b.click(); return !!b;
  })()`);
  await sleep(400);
  record("重新展开后项目条件保留", await evaluate(`(() => {
    const project = document.querySelector('form input[placeholder*="项目"]');
    return project ? project.value : null;
  })()`));
  await shoot("03_filter_reopened");

  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(results, null, 2));
  console.log("\n结果已写入", path.join(OUT, "report.json"));
} catch (error) {
  console.error("验证中断:", error.message);
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ error: error.message, results }, null, 2));
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* 忽略 */ }
  chrome?.kill();
  server.kill();
  await sleep(400);
  fs.rmSync(profile, { recursive: true, force: true });
  process.exit(process.exitCode ?? 0);
}
