// 列宽现状测量：只读，不改 UI。输出每档视口下调用记录与技能库列表的真实列宽与截断情况。
// 用法：node output/column-widths/measure.mjs [tag]
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const tag = process.argv[2] ?? "before";
const root = path.resolve("output/column-widths");
const runId = `measure-${tag}-${Date.now()}`;
const dataRoot = path.join(root, "data", runId);
const home = path.join(dataRoot, "home");
const outDir = path.join(root, "evidence", tag);
fs.mkdirSync(outDir, { recursive: true });

const NODE = process.execPath;
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"]
  .find(candidate => fs.existsSync(candidate));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  probe.on("error", reject);
});

await new Promise((resolve, reject) => {
  const seeded = spawn(NODE, [path.join(root, "seed.mjs")], {
    stdio: "inherit", windowsHide: true, env: { ...process.env, COLWIDTH_DATA: dataRoot },
  });
  seeded.on("exit", code => (code === 0 ? resolve() : reject(new Error(`seed 失败：${code}`))));
});

const port = await freePort();
const debugPort = await freePort();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "colwidth-profile-"));
const server = spawn(NODE, ["backend/server.mjs", "--port", String(port), "--directory", path.join(home, ".skills-manager"), "--home", home],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = "";
server.stdout.on("data", chunk => { serverLog += chunk; });
server.stderr.on("data", chunk => { serverLog += chunk; });

let chrome;
let ws;
const report = {};
try {
  const deadline = Date.now() + 20000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* 等待 */ }
    if (Date.now() > deadline) throw new Error(`服务未就绪：${serverLog}`);
    await sleep(150);
  }

  let target = null;
  for (let attempt = 0; attempt < 2 && !target; attempt++) {
    if (chrome) { try { chrome.kill(); } catch { /* ignore */ } }
    const attemptPort = attempt === 0 ? debugPort : await freePort();
    chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
      `--remote-debugging-port=${attemptPort}`, "--remote-allow-origins=*", `--user-data-dir=${profile}`,
      "--window-size=1920,1080", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
    chrome.stdout.on("data", () => {});
    chrome.stderr.on("data", () => {});
    for (let index = 0; index < 60 && !target; index++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${attemptPort}/json/list`)).json();
        target = list.find(item => item.type === "page" && item.webSocketDebuggerUrl);
      } catch { /* 等端口 */ }
      if (!target) await sleep(250);
    }
  }
  if (!target) throw new Error("找不到可调试的页面目标");

  ws = new WebSocket(target.webSocketDebuggerUrl);
  if (ws.readyState !== 1) await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (entry) { pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); }
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params ?? {} }));
  });
  const evaluate = async (expression, awaitPromise = false) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
    if (result.exceptionDetails) throw new Error(`表达式执行失败：${result.exceptionDetails.text}`);
    return result.result?.value;
  };
  const goto = async url => { await send("Page.navigate", { url }); await sleep(2600); };
  const viewport = async (width, height) => {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await sleep(600);
  };
  const shoot = async name => {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(shot.data, "base64"));
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await goto(`http://127.0.0.1:${port}/`);
  await evaluate(`localStorage.setItem('theme','light'); localStorage.setItem('language','zh')`);

  for (const width of [1280, 1536, 1920]) {
    await viewport(width, 1000);

    // ── 调用记录 ──
    await goto(`http://127.0.0.1:${port}/skill-activity`);
    report[`activity@${width}`] = await evaluate(`(() => {
      const row = document.querySelector('[aria-label^="查看"]') || [...document.querySelectorAll('[role="button"]')].find(el => el.getAttribute('aria-pressed') !== null);
      const rows = [...document.querySelectorAll('[role="button"]')].filter(el => el.getAttribute('aria-pressed') !== null);
      if (!rows.length) return { error: 'no rows' };
      const first = rows[0];
      const template = getComputedStyle(first).gridTemplateColumns;
      const widths = template.split(' ').map(Number);
      const container = first.getBoundingClientRect().width;
      const nameEl = first.querySelector('button, span.text-primary');
      const cells = [...first.children].map((cell, index) => ({
        index,
        width: Math.round(cell.getBoundingClientRect().width),
        text: cell.textContent.replace(/\\s+/g, ' ').trim().slice(0, 40),
      }));
      return {
        rows: rows.length,
        container: Math.round(container),
        widths,
        fixedTotal: widths.slice(1).reduce((a, b) => a + b, 0),
        gaps: Math.round(parseFloat(getComputedStyle(first).columnGap) || 0),
        cells,
        skillNameTruncated: nameEl ? nameEl.scrollWidth > nameEl.clientWidth + 1 : null,
        skillNameWidth: nameEl ? Math.round(nameEl.getBoundingClientRect().width) : null,
      };
    })()`);
    await shoot(`activity_${width}`);

    // ── 技能库（列表视图） ──
    await goto(`http://127.0.0.1:${port}/my-skills`);
    await evaluate(`(() => { const button = [...document.querySelectorAll('button[aria-label]')].find(b => b.getAttribute('aria-label') === '列表视图'); if (button) button.click(); return true; })()`);
    await sleep(1200);
    report[`library@${width}`] = await evaluate(`(() => {
      const rows = [...document.querySelectorAll('.app-panel')].filter(el => el.querySelector('h3') && el.querySelector('p'));
      if (!rows.length) return { error: 'no rows' };
      const row = rows[0];
      const name = row.querySelector('h3');
      const desc = row.querySelector('p');
      const children = [...row.children].slice(1).map((cell) => ({
        tag: cell.tagName.toLowerCase(),
        width: Math.round(cell.getBoundingClientRect().width),
        truncated: cell.scrollWidth > cell.clientWidth + 1,
        text: cell.textContent.replace(/\\s+/g, ' ').trim().slice(0, 36),
      }));
      return {
        rows: rows.length,
        rowWidth: Math.round(row.getBoundingClientRect().width),
        nameWidth: Math.round(name.getBoundingClientRect().width),
        nameTruncated: name.scrollWidth > name.clientWidth + 1,
        descWidth: Math.round(desc.getBoundingClientRect().width),
        descTruncated: desc.scrollWidth > desc.clientWidth + 1,
        children,
      };
    })()`);
    await shoot(`library_list_${width}`);
  }
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  try { chrome?.kill(); } catch { /* ignore */ }
  try { server.kill(); } catch { /* ignore */ }
}

fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
