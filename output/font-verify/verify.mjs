// 字体切换无头验收：隔离 fixture（英文技能 animation-vocabulary）+ backend + headless Chrome，
// 用 CSS.getPlatformFontsForNode 实测各区域英文文本真正落到的平台字体，并截图留证。
// 用法：node output/font-verify/verify.mjs [before|after]
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const label = process.argv[2] ?? "run";
const root = path.resolve("output/font-verify");
const home = path.join(root, "data", "home");
const evidence = path.join(root, "evidence", label);
fs.mkdirSync(evidence, { recursive: true });

const NODE = process.execPath;
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"]
  .find(candidate => fs.existsSync(candidate));
if (!CHROME) throw new Error("未找到 Chrome 或 Edge");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  probe.on("error", reject);
});

const results = [];
const record = (name, value) => { results.push({ name, value }); console.log(`· ${name}: ${JSON.stringify(value)}`); };

const port = await freePort();
const debugPort = await freePort();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "font-verify-profile-"));

const server = spawn(NODE, ["backend/server.mjs", "--port", String(port), "--directory", path.join(home, ".skills-manager"), "--home", home],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = "";
server.stdout.on("data", chunk => { serverLog += chunk; });
server.stderr.on("data", chunk => { serverLog += chunk; });

let chrome;
let ws;
try {
  const deadline = Date.now() + 20000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* 还没起来 */ }
    if (Date.now() > deadline) throw new Error(`本地服务未就绪：${serverLog}`);
    await sleep(150);
  }

  chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*", `--user-data-dir=${profile}`,
    "--window-size=1536,1024", "about:blank"], { stdio: "ignore" });

  let target = null;
  for (let index = 0; index < 160 && !target; index++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      target = list.find(item => item.type === "page" && item.webSocketDebuggerUrl);
    } catch { /* 等 Chrome 打开调试端口 */ }
    if (!target) await sleep(250);
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
    if (result.exceptionDetails) throw new Error(`表达式执行失败：${result.exceptionDetails.text} ${JSON.stringify(result.result?.value ?? "")}`);
    return result.result?.value;
  };
  const shoot = async (name, { full = false } = {}) => {
    const height = full
      ? Math.max(600, Math.min(await evaluate("Math.max(document.scrollingElement.scrollHeight, document.body.scrollHeight)"), 8000))
      : null;
    const shot = await send("Page.captureScreenshot", {
      format: "png",
      ...(full ? { captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1536, height, scale: 1 } } : {}),
    });
    fs.writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(shot.data, "base64"));
    console.log(`  SHOT ${name}.png${full ? ` (${height}px)` : ""}`);
  };
  const goto = async url => { await send("Page.navigate", { url }); await sleep(2200); };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("DOM.enable");
  await send("CSS.enable");

  // 实测某选择器命中的节点真正使用哪些平台字体
  const platformFonts = async selector => {
    const { root: doc } = await send("DOM.getDocument");
    const { nodeId } = await send("DOM.querySelector", { nodeId: doc.nodeId, selector });
    if (!nodeId) return null;
    const pf = await send("CSS.getPlatformFontsForNode", { nodeId });
    return (pf.fonts ?? []).map(f => `${f.familyName} ×${f.glyphCount}`).join(" + ");
  };

  // ── 浅色主题 · 列表页 ──
  await goto(`http://127.0.0.1:${port}/my-skills`);
  await evaluate(`localStorage.setItem('theme','light')`);
  await goto(`http://127.0.0.1:${port}/my-skills`);
  record("body 计算字体栈", await evaluate(`getComputedStyle(document.body).fontFamily`));
  record("列表卡片标题字体（英文技能名）", await platformFonts(".app-panel h3"));
  await shoot("01_list_light");

  // ── 打开英文技能详情 ──
  await evaluate(`(() => { const card = [...document.querySelectorAll('.app-panel')].find(el => el.textContent.includes('animation-vocabulary')); card.click(); return !!card; })()`);
  await sleep(1600);
  record("详情页已打开", await evaluate(`!!document.querySelector('.skill-detail-shell')`));
  // 展开「来源详情」，测量路径行的字体
  await evaluate(`(() => { const aside = document.querySelector('aside');
    const section = [...aside.querySelectorAll('section')].find(s => s.textContent.includes('来源信息'));
    const details = [...section.querySelectorAll('button')].find(b => b.textContent.trim() === '来源详情');
    if (details && details.getAttribute('aria-expanded') !== 'true') details.click();
    return !!details; })()`);
  await sleep(400);
  record("详情标题字体（英文）", await platformFonts(".skill-detail-shell h2"));
  record("正文段落字体（英文散文）", await platformFonts(".skill-detail-markdown p"));
  record("行内代码字体", await platformFonts(".skill-detail-markdown .skill-md-inline-code"));
  record("代码块语言标签字体（font-mono 类）", await platformFonts(".skill-detail-markdown .font-mono"));
  record("来源路径字体（font-mono 类）", await platformFonts(".skill-detail-shell dd.font-mono"));
  await evaluate(`(() => { document.querySelector('.skill-detail-main').scrollTop = 500; return true; })()`);
  await sleep(500);
  await shoot("02_detail_light");
  await shoot("02_detail_light_full", { full: true });

  // ── 深色主题 ──
  await evaluate(`localStorage.setItem('theme','dark')`);
  await goto(`http://127.0.0.1:${port}/my-skills`);
  await evaluate(`(() => { const card = [...document.querySelectorAll('.app-panel')].find(el => el.textContent.includes('animation-vocabulary')); card.click(); return true; })()`);
  await sleep(1600);
  record("深色正文段落字体", await platformFonts(".skill-detail-markdown p"));
  await evaluate(`(() => { document.querySelector('.skill-detail-main').scrollTop = 500; return true; })()`);
  await sleep(500);
  await shoot("03_detail_dark");

  fs.writeFileSync(path.join(evidence, "report.json"), JSON.stringify({ label, results }, null, 2));
  console.log(`\n[${label}] 验收完成，结果写入 ${path.join("output/font-verify/evidence", label, "report.json")}`);
} catch (error) {
  console.error("验收中断：", error.message);
  fs.writeFileSync(path.join(evidence, "report.json"), JSON.stringify({ label, error: error.message, results }, null, 2));
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* 忽略关闭异常 */ }
  chrome?.kill();
  server.kill();
  await sleep(400);
  fs.rmSync(profile, { recursive: true, force: true });
  process.exit(process.exitCode ?? 0);
}
