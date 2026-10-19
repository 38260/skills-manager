// 快速探测 lg 档（1024/1200/1280）下左列是否被挤坏：只起服务+Chrome，量一次就退。
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
const root = path.resolve("output/detail-height");
const dataRoot = path.join(root, "data", `probe-${Date.now()}`);
const home = path.join(dataRoot, "home");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const p = net.createServer(); p.listen(0, "127.0.0.1", () => { const { port } = p.address(); p.close(() => res(port)); }); p.on("error", rej); });
const NODE = process.execPath;
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe"].find(f => fs.existsSync(f));
await new Promise((res, rej) => { const s = spawn(NODE, [path.resolve("output/column-widths/seed.mjs")], { stdio: "ignore", windowsHide: true, env: { ...process.env, COLWIDTH_DATA: dataRoot } }); s.on("exit", c => c === 0 ? res() : rej(new Error("seed"))); });
const port = await freePort(); const dbg = await freePort();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "probe-profile-"));
const server = spawn(NODE, ["backend/server.mjs", "--port", String(port), "--directory", path.join(home, ".skills-manager"), "--home", home], { stdio: "ignore", windowsHide: true });
for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch {} await sleep(150); }
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${dbg}`, "--remote-allow-origins=*", `--user-data-dir=${profile}`, "--window-size=1200,950", "about:blank"], { stdio: "ignore", windowsHide: true });
let target = null;
for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); target = l.find(t => t.type === "page"); } catch {} if (!target) await sleep(250); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener("open", r, { once: true }));
let seq = 0; const pend = new Map();
ws.addEventListener("message", e => { const m = JSON.parse(e.data); const p = pend.get(m.id); if (p) { pend.delete(m.id); p(m.result?.result?.value); } });
const send = (method, params) => new Promise(r => { const id = ++seq; pend.set(id, r); ws.send(JSON.stringify({ id, method, params: params ?? {} })); });
const evalx = async ex => await send("Runtime.evaluate", { expression: ex, returnByValue: true });
await send("Page.enable"); await send("Runtime.enable");
await send("Page.navigate", { url: `http://127.0.0.1:${port}/` }); await sleep(2500);
await evalx(`localStorage.setItem('theme','light');localStorage.setItem('language','zh')`);
for (const [w, h] of [[1024, 950], [1200, 950], [1280, 950]]) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/skill-activity` }); await sleep(2500);
  const m = await evalx(`(() => {
    const section = [...document.querySelectorAll('section[aria-label]')].find(el => el.querySelector('[role="tablist"]'));
    const list = section.querySelector(':scope > div.min-h-0');
    const aside = document.querySelector('aside');
    const stats = [...document.querySelectorAll('section[aria-label]')].find(el => el.querySelector('[class*="sm:grid-cols-4"]'));
    const statCard = stats?.querySelector('[class*="sm:grid-cols-4"] > div');
    const filter = [...document.querySelectorAll('div.app-panel')].find(el => el.querySelector('input[aria-label]'));
    const rect = el => el ? el.getBoundingClientRect() : null;
    return {
      width: ${w},
      detail: Math.round(rect(aside).height), detailW: Math.round(rect(aside).width),
      listScroll: list.clientHeight,
      statsH: Math.round(rect(stats).height), statCardW: Math.round(rect(statCard).width),
      statLabelClipped: statCard ? statCard.scrollWidth > statCard.clientWidth : null,
      filterH: Math.round(rect(filter).height),
      pageScrollable: (() => { const o = document.getElementById('page-scroll-container'); return o.scrollHeight > o.clientHeight + 1; })(),
    };
  })()`);
  console.log(JSON.stringify(m));
}
ws.close(); chrome.kill(); server.kill(); process.exit(0);
