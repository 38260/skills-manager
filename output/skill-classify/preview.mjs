// 分类结果的可视化复核：用真实技能库 + 隔离 home 起本地服务与 headless Chrome，截图并断言分类渲染。
// 不改动技能库之外的数据（activity 库指向隔离 home，不写用户的真实调用记录）。
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const LIBRARY = "C:/Users/luckyzyb/.skills-manager";
const evidence = path.resolve("output/skill-classify/evidence");
fs.mkdirSync(evidence, { recursive: true });
const CATEGORIES = ["界面设计", "动效与视频", "前端验证", "文档与演示", "学术科研", "调研与学习", "生活与资讯", "工程与发布", "流程与协作", "图像理解"];

const NODE = process.execPath;
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  probe.on("error", reject);
});

const home = fs.mkdtempSync(path.join(os.tmpdir(), "skill-classify-home-"));
const port = await freePort();
const debugPort = await freePort();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "skill-classify-profile-"));

const server = spawn(NODE, ["backend/server.mjs", "--port", String(port), "--directory", LIBRARY, "--home", home],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let log = "";
server.stdout.on("data", c => { log += c; });
server.stderr.on("data", c => { log += c; });

let chrome, ws;
try {
  const deadline = Date.now() + 20000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* 等待服务 */ }
    if (Date.now() > deadline) throw new Error(`本地服务未就绪：${log}`);
    await sleep(150);
  }

  chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*", `--user-data-dir=${profile}`,
    "--window-size=1536,1024", "about:blank"], { stdio: "ignore" });

  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      target = list.find(item => item.type === "page" && item.webSocketDebuggerUrl);
    } catch { /* 等待 Chrome */ }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error("找不到可调试的页面目标");

  ws = new WebSocket(target.webSocketDebuggerUrl);
  if (ws.readyState !== 1) await new Promise(r => ws.addEventListener("open", r, { once: true }));
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
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(`表达式失败：${result.exceptionDetails.text}`);
    return result.result?.value;
  };
  const shoot = async (name, full = false) => {
    const height = full ? Math.min(await evaluate("Math.max(document.scrollingElement.scrollHeight, document.body.scrollHeight)"), 12000) : null;
    const shot = await send("Page.captureScreenshot", { format: "png", ...(full ? { captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1536, height, scale: 1 } } : {}) });
    fs.writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(shot.data, "base64"));
    console.log(`  SHOT ${name}.png${full ? ` (${height}px)` : ""}`);
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/my-skills` });
  await sleep(3000);
  await evaluate(`localStorage.setItem('theme','light')`);
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/my-skills` });
  await sleep(3000);

  const chips = await evaluate(`(() => {
    const wanted = ${JSON.stringify(CATEGORIES)};
    const buttons = [...document.querySelectorAll('button')];
    return wanted.map(name => {
      const button = buttons.find(item => item.textContent.trim().startsWith(name));
      return button ? { name, count: button.textContent.replace(name, '').trim() } : { name, count: null };
    });
  })()`);
  console.log("分类筛选条:", JSON.stringify(chips));

  const cards = await evaluate(`(() => {
    const panels = [...document.querySelectorAll('.app-panel')].filter(el => el.querySelector('h4, h3'));
    const tagged = panels.filter(el => ${JSON.stringify(CATEGORIES)}.some(name => el.textContent.includes(name)));
    return { panels: panels.length, taggedCards: tagged.length,
      sample: tagged.slice(0, 3).map(el => el.textContent.replace(/\\s+/g, ' ').trim().slice(0, 60)) };
  })()`);
  console.log("卡片:", JSON.stringify(cards));
  await shoot("01_my_skills_categories");
  await shoot("01_my_skills_categories_full", true);

  // 点一个分类筛选，确认联动
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim().startsWith('学术科研'));
    if (!button) return null; button.click(); return button.textContent.trim();
  })()`);
  await sleep(1200);
  const filtered = await evaluate(`(() => {
    const panels = [...document.querySelectorAll('.app-panel')].filter(el => el.querySelector('h4, h3'));
    return { clicked: ${JSON.stringify(clicked)}, cards: panels.length, names: panels.map(el => el.querySelector('h4, h3')?.textContent?.trim()).slice(0, 10) };
  })()`);
  console.log("筛选后:", JSON.stringify(filtered));
  await shoot("02_filter_research");

  await evaluate(`localStorage.setItem('theme','dark')`);
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/my-skills` });
  await sleep(3000);
  await shoot("03_my_skills_categories_dark");

  fs.writeFileSync(path.join(evidence, "report.json"), JSON.stringify({ chips, cards, filtered }, null, 2));
  console.log("\n复核完成，证据在 output/skill-classify/evidence/");
} catch (error) {
  console.error("复核中断：", error.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* 忽略 */ }
  chrome?.kill(); server.kill();
  await sleep(400);
  fs.rmSync(profile, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
  process.exit(process.exitCode ?? 0);
}
