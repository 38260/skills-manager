// 真实库布局测量：正文区两侧留白、页签行可用宽度、右上角控件位置。
// 只读，不改任何数据。用法：node output/detail-width/measure.mjs [tag]
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const tag = process.argv[2] ?? "measure";
const root = path.resolve("output/detail-width");
const evidence = path.join(root, "evidence", tag);
fs.mkdirSync(evidence, { recursive: true });

const NODE = process.execPath;
const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Chromium/Application/chrome.exe",
].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  probe.on("error", reject);
});

const port = await freePort();
const debugPort = await freePort();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "detail-width-"));
const home = os.homedir();

const server = spawn(NODE, ["backend/server.mjs", "--port", String(port), "--directory", path.join(home, ".skills-manager"), "--home", home],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = "";
server.stdout.on("data", c => { serverLog += c; });
server.stderr.on("data", c => { serverLog += c; });

const invoke = (command, args = {}) => fetch(`http://127.0.0.1:${port}/api/invoke/${command}`, {
  method: "POST", headers: { "content-type": "application/json", "x-skills-manager-client": "webview" }, body: JSON.stringify(args),
}).then(async r => { const p = await r.json(); if (!p?.ok) throw new Error(`${command}: ${p?.message}`); return p.data; });

let chrome, ws;
try {
  const deadline = Date.now() + 25000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* wait */ }
    if (Date.now() > deadline) throw new Error(`服务未就绪：${serverLog}`);
    await sleep(200);
  }

  let target = null, chromeLog = "";
  for (let attempt = 0; attempt < 2 && !target; attempt++) {
    if (chrome) { try { chrome.kill(); } catch { /* ignore */ } }
    const attemptPort = attempt === 0 ? debugPort : await freePort();
    chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", `--remote-debugging-port=${attemptPort}`,
      "--remote-allow-origins=*", `--user-data-dir=${profile}`, "--window-size=1600,1000", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
    chrome.stderr.on("data", c => { chromeLog += c; });
    for (let i = 0; i < 60 && !target; i++) {
      try { const list = await (await fetch(`http://127.0.0.1:${attemptPort}/json/list`)).json(); target = list.find(x => x.type === "page" && x.webSocketDebuggerUrl); } catch { /* wait */ }
      if (!target) await sleep(250);
    }
  }
  if (!target) throw new Error(`找不到页面目标：${chromeLog.slice(0, 300)}`);

  ws = new WebSocket(target.webSocketDebuggerUrl);
  if (ws.readyState !== 1) await new Promise(r => ws.addEventListener("open", r, { once: true }));
  let seq = 0; const pending = new Map();
  ws.addEventListener("message", e => { const m = JSON.parse(e.data); const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } });
  const send = (method, params) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params: params ?? {} })); });
  const evaluate = async (expression, awaitPromise = false) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error(`表达式失败：${r.exceptionDetails.text}`);
    return r.result?.value;
  };
  const goto = async url => { await send("Page.navigate", { url }); await sleep(2800); };
  const shoot = async name => { const s = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(s.data, "base64")); };

  await send("Page.enable"); await send("Runtime.enable");
  await invoke("set_settings", { key: "theme", value: "light" });
  await goto(`http://127.0.0.1:${port}/`);
  await evaluate(`localStorage.setItem('theme','light'); localStorage.setItem('language','zh')`);

  // 挑一个真实的长文档技能（英文原文但已有中文版），逐个候选尝试打开
  const skills = await invoke("get_managed_skills");
  const candidates = skills.filter(s => /apple-design|design-taste|codex-with-chatgpt|remotion|pyinstaller/i.test(s.name)).map(s => s.name);
  console.log("候选技能:", candidates.join(", ") || "(无)");

  await goto(`http://127.0.0.1:${port}/my-skills`);
  const openDetail = name => evaluate(`(async () => {
    const waitFor = async (t, n) => { for (let i = 0; i < n; i++) { const v = t(); if (v) return v; await new Promise(r => setTimeout(r, 200)); } return null; };
    if (document.querySelector('.skill-detail-shell')) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    const card = await waitFor(() => [...document.querySelectorAll('.app-panel')].find(el => el.textContent.includes(${JSON.stringify(name)}) && el.getBoundingClientRect().width > 0), 60);
    if (!card) return false;
    card.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 200)); card.click();
    return !!(await waitFor(() => document.querySelector('.skill-detail-shell'), 50));
  })()`, true);

  let openedName = null;
  for (const name of candidates) {
    const ok = await openDetail(name);
    if (ok) { openedName = name; break; }
    await goto(`http://127.0.0.1:${port}/my-skills`);
  }
  if (!openedName) throw new Error("未能打开任何候选技能详情");
  console.log("已打开:", openedName);
  await sleep(1500);

  const measure = await evaluate(`(() => {
    const r = el => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right) }; };
    const shell = document.querySelector('.skill-detail-shell');
    const header = shell.querySelector('header');
    const row = shell.querySelector('nav[aria-label]')?.parentElement;
    const nav = shell.querySelector('nav[aria-label]');
    const ctrl = row?.querySelector('[role="group"]')?.parentElement;
    const main = shell.querySelector('.skill-detail-main');
    const reader = main?.firstElementChild;
    const article = main?.querySelector('article');
    return {
      innerWidth, shell: r(shell), header: r(header), row: r(row), nav: r(nav), ctrl: ctrl ? r(ctrl) : null,
      main: r(main), reader: reader ? r(reader) : null, article: article ? r(article) : null,
      mainPadding: main ? { left: getComputedStyle(main).paddingLeft, right: getComputedStyle(main).paddingRight } : null,
      // 正文实际可用宽度 vs 面板宽度
      gapLeft: reader && main ? Math.round(reader.getBoundingClientRect().x - main.getBoundingClientRect().x) : null,
      gapRight: reader && main ? Math.round(main.getBoundingClientRect().right - reader.getBoundingClientRect().right) : null,
      rowRightGap: row && ctrl ? Math.round(row.getBoundingClientRect().right - ctrl.getBoundingClientRect().right) : null,
      headerRightGap: header && ctrl ? Math.round(header.getBoundingClientRect().right - ctrl.getBoundingClientRect().right) : null,
      title: shell.querySelector('h2')?.textContent?.trim() ?? null,
      textLen: main?.textContent?.length ?? 0,
    };
  })()`);
  console.log(JSON.stringify(measure, null, 1));
  await shoot("01_real_detail_1600");

  // 右侧目录栏是否存在
  const aside = await evaluate(`(() => {
    const shell = document.querySelector('.skill-detail-shell');
    const main = shell.querySelector('.skill-detail-main');
    const siblings = [...(main?.parentElement?.children ?? [])].map(el => ({ tag: el.tagName, cls: (el.className||'').toString().slice(0,50), w: Math.round(el.getBoundingClientRect().width) }));
    return siblings;
  })()`);
  console.log("主区兄弟节点:", JSON.stringify(aside));

  fs.writeFileSync(path.join(evidence, "measure.json"), JSON.stringify({ openedName, measure, aside }, null, 2));
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  if (chrome) { try { chrome.kill(); } catch { /* ignore */ } }
  if (server) { try { server.kill(); } catch { /* ignore */ } }
}
