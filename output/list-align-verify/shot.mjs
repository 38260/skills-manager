// 截图技能库的列表视图，用于确认列对齐问题。
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const DIR = "C:/Users/luckyzyb/.skills-manager";
const HOME = "D:/AIWorkSpace/Codex/SkillManager/skills-manager/output/list-align-verify/data";
const OUT = "output/list-align-verify";
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(HOME, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const record = (name, value) => { results.push({ name, value }); console.log(`· ${name}: ${JSON.stringify(value)}`); };
const freePort = () => new Promise((res, rej) => {
  const p = net.createServer();
  p.listen(0, "127.0.0.1", () => { const { port } = p.address(); p.close(() => res(port)); });
  p.on("error", rej);
});

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(c => fs.existsSync(c));
const port = await freePort();
const debugPort = await freePort();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "list-align-"));
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
    "--window-size=1600,1000", "about:blank"], { stdio: "ignore" });

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
  const shoot = async (name, full = false) => {
    const height = full ? Math.max(600, Math.min(await evaluate("Math.max(document.scrollingElement.scrollHeight, document.body.scrollHeight)"), 8000)) : null;
    const shot = await send("Page.captureScreenshot", {
      format: "png",
      ...(full ? { captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1600, height, scale: 1 } } : {}),
    });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(shot.data, "base64"));
    console.log(`  SHOT ${name}.png`);
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/my-skills` });
  await sleep(2800);
  await evaluate(`localStorage.setItem('theme','light')`);
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/my-skills` });
  await sleep(2800);
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('全新开始')); if (b) b.click(); return !!b; })()`);
  await sleep(800);

  // 切到列表视图
  await shoot("00_grid_view");
  record("网格视图 role=switch 数量", await evaluate(`document.querySelectorAll('[role="switch"]').length`));

  const switched = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.querySelector('svg.lucide-list'));
    if (btn) { btn.click(); return true; }
    return false;
  })()`);
  console.log("切到列表视图:", switched);
  await sleep(1200);
  await shoot("01_list_view");
  record("列表视图 role=switch 数量", await evaluate(`document.querySelectorAll('[role="switch"]').length`));

  // 测量每行各列的起始 x，确认是否对齐
  const cols = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.app-panel')].filter(el => el.className.includes('items-center') && el.querySelector('h3'));
    return rows.slice(0, 6).map(row => {
      const h3 = row.querySelector('h3');
      const children = [...row.children].filter(c => !c.className.includes('absolute'));
      return children.map(c => Math.round(c.getBoundingClientRect().left));
    });
  })()`);
  console.log("\n每行各列起始 x 坐标（前 6 行）:");
  for (const [i, row] of (cols ?? []).entries()) console.log(`  row${i}: ${JSON.stringify(row)}`);

  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ switched, cols }, null, 2));
} catch (error) {
  console.error("中断:", error.message);
} finally {
  try { ws?.close(); } catch { /* 忽略 */ }
  chrome?.kill();
  server.kill();
  await sleep(400);
  fs.rmSync(profile, { recursive: true, force: true });
  process.exit(0);
}
