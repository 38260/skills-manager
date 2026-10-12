// 验证设置页 Agent 移除 / 恢复的完整交互。
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const BASE = path.resolve("output/feature-verify/data");
const DIR = `${BASE}/.skills-manager`;
const HOME = BASE;
const OUT = "output/feature-verify";

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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "agent-verify-"));
const server = spawn(process.execPath,
  ["backend/server.mjs", "--port", String(port), "--directory", DIR, "--home", HOME],
  { stdio: "ignore", windowsHide: true });

let chrome;
let ws;
try {
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* 等 */ }
    await sleep(150);
  }
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
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/settings` });
  await sleep(2500);
  await evaluate(`localStorage.setItem('theme','light')`);
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/settings` });
  await sleep(2500);
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('全新开始')); if (b) b.click(); return !!b; })()`);
  await sleep(800);
  // 自动确认所有原生 confirm（移除操作会弹确认）
  await evaluate(`window.confirm = () => true`);

  const snapshot = `(() => {
    const btns = [...document.querySelectorAll('button[title="从列表移除"]')];
    const text = document.body.textContent;
    const sidebar = document.querySelector('[class*="w-[220px]"]');
    const sidebarText = sidebar ? sidebar.textContent : '';
    return {
      removeButtons: btns.length,
      hasHiddenSection: /已移除的 Agent/.test(text),
      detectedCount: (text.match(/已检测\\s*(\\d+)/) || [])[1] ?? null,
      sidebarAgents: ['Claude Code', 'Codex'].filter(n => sidebarText.includes(n)),
    };
  })()`;

  record("初始状态", await evaluate(snapshot));

  // 点击第一个"从列表移除"
  record("点击移除按钮", await evaluate(`(() => {
    const btn = document.querySelector('button[title="从列表移除"]');
    if (!btn) return false;
    btn.click(); return true;
  })()`));
  await sleep(1500);
  record("移除后状态", await evaluate(snapshot));
  await shoot("04_agent_removed");

  // 展开"已移除的 Agent"分组并恢复
  record("展开已移除分组", await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /已移除的 Agent/.test(b.textContent));
    if (!btn) return false;
    btn.click(); return true;
  })()`));
  await sleep(600);
  record("展开已移除分组后", await evaluate(snapshot));
  await shoot("05_hidden_section");

  record("点击恢复按钮", await evaluate(`(() => {
    const btn = document.querySelector('button[title="恢复到列表"]');
    if (!btn) return false;
    btn.click(); return true;
  })()`));
  await sleep(1500);
  record("恢复后状态", await evaluate(snapshot));
  await shoot("06_agent_restored");

  fs.writeFileSync(path.join(OUT, "agent-report.json"), JSON.stringify(results, null, 2));
  console.log("\n结果已写入", path.join(OUT, "agent-report.json"));
} catch (error) {
  console.error("验证中断:", error.message);
  fs.writeFileSync(path.join(OUT, "agent-report.json"), JSON.stringify({ error: error.message, results }, null, 2));
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* 忽略 */ }
  chrome?.kill();
  server.kill();
  await sleep(400);
  fs.rmSync(profile, { recursive: true, force: true });
  process.exit(process.exitCode ?? 0);
}
