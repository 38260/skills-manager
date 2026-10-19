// 诊断：默认「中文版」时，右侧目录的语言是否与正文一致。
// 对比两类技能：有译文的英文原文（apple-design）、无译文的中文原文（aihot）。
// 用法：node output/detail-width/toc-probe.mjs
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const NODE = process.execPath;
const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  probe.on("error", reject);
});

const port = await freePort();
const debugPort = await freePort();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "toc-probe-"));
const home = os.homedir();

const server = spawn(NODE, ["backend/server.mjs", "--port", String(port), "--directory", path.join(home, ".skills-manager"), "--home", home],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = "";
server.stdout.on("data", c => { serverLog += c; });
server.stderr.on("data", c => { serverLog += c; });

let chrome, ws;
try {
  const deadline = Date.now() + 25000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* wait */ }
    if (Date.now() > deadline) throw new Error(`服务未就绪：${serverLog}`);
    await sleep(200);
  }

  let target = null;
  for (let attempt = 0; attempt < 2 && !target; attempt++) {
    if (chrome) { try { chrome.kill(); } catch { /* ignore */ } }
    const ap = attempt === 0 ? debugPort : await freePort();
    chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", `--remote-debugging-port=${ap}`,
      "--remote-allow-origins=*", `--user-data-dir=${profile}`, "--window-size=1600,1000", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
    for (let i = 0; i < 60 && !target; i++) {
      try { const l = await (await fetch(`http://127.0.0.1:${ap}/json/list`)).json(); target = l.find(x => x.type === "page" && x.webSocketDebuggerUrl); } catch { /* wait */ }
      if (!target) await sleep(250);
    }
  }
  if (!target) throw new Error("找不到页面目标");

  ws = new WebSocket(target.webSocketDebuggerUrl);
  if (ws.readyState !== 1) await new Promise(r => ws.addEventListener("open", r, { once: true }));
  let seq = 0; const pending = new Map();
  ws.addEventListener("message", e => { const m = JSON.parse(e.data); const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } });
  const send = (method, params) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params: params ?? {} })); });
  const evaluate = async (expr, awaitPromise = false) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error(`表达式失败：${r.exceptionDetails.text}`);
    return r.result?.value;
  };
  const goto = async url => { await send("Page.navigate", { url }); await sleep(2800); };

  await send("Page.enable"); await send("Runtime.enable");
  await goto(`http://127.0.0.1:${port}/`);
  await evaluate(`localStorage.setItem('theme','light'); localStorage.setItem('language','zh')`);

  const openDetail = name => evaluate(`(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await new Promise(r => setTimeout(r, 400));
    const waitFor = async (t, n) => { for (let i = 0; i < n; i++) { const v = t(); if (v) return v; await new Promise(r => setTimeout(r, 200)); } return null; };
    const card = await waitFor(() => [...document.querySelectorAll('.app-panel')].find(el => el.textContent.includes(${JSON.stringify(name)}) && el.getBoundingClientRect().width > 0), 60);
    if (!card) return false;
    card.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 200)); card.click();
    return !!(await waitFor(() => document.querySelector('.skill-detail-shell'), 50));
  })()`, true);

  const probe = `(() => {
    const shell = document.querySelector('.skill-detail-shell');
    if (!shell) return { missing: true };
    const group = shell.querySelector('nav[aria-label]')?.parentElement?.querySelector('[role="group"]');
    const zhBtn = group ? [...group.querySelectorAll('button')].find(b => b.textContent.includes('中文版')) : null;
    const aside = shell.querySelector('aside');
    // 目录项：侧栏 TOC 面板里的 nav（侧栏 tab 是 role="tab"，不在 nav 里）
    const tocNav = aside?.querySelector('nav[aria-label]');
    const tocLinks = tocNav ? [...tocNav.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean) : [];
    const main = shell.querySelector('.skill-detail-main');
    // 正文里真实渲染的标题
    const bodyHeadings = main ? [...main.querySelectorAll('h1,h2,h3')].map(h => h.textContent.trim()).slice(0, 5) : [];
    const isCjk = s => /[\\u4e00-\\u9fff]/.test(s);
    return {
      zhPressed: zhBtn?.getAttribute('aria-pressed') ?? null,
      tocCount: tocLinks.length,
      tocSample: tocLinks.slice(0, 5),
      tocChinese: tocLinks.length ? tocLinks.filter(isCjk).length : 0,
      bodyHeadings,
      bodyChinese: bodyHeadings.length ? bodyHeadings.filter(isCjk).length : 0,
      mainText: (main?.textContent ?? '').slice(0, 90),
    };
  })()`;

  for (const name of ["apple-design", "aihot"]) {
    await goto(`http://127.0.0.1:${port}/my-skills`);
    const ok = await openDetail(name);
    if (!ok) { console.log(name, "打不开"); continue; }
    await sleep(2000);
    const r = await evaluate(probe);
    console.log(`\n── ${name} ──`);
    console.log("  中文版按钮 pressed:", r.zhPressed);
    console.log("  目录条数:", r.tocCount, "其中中文:", r.tocChinese);
    console.log("  目录样本:", JSON.stringify(r.tocSample));
    console.log("  正文标题:", JSON.stringify(r.bodyHeadings), "其中中文:", r.bodyChinese);
    console.log("  正文开头:", JSON.stringify(r.mainText.slice(0, 60)));
  }
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  if (chrome) { try { chrome.kill(); } catch { /* ignore */ } }
  if (server) { try { server.kill(); } catch { /* ignore */ } }
}
