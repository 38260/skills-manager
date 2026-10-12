// 第五轮四项改动的**界面级**验收：起真实后端（同时 serve dist/），用无头 Chrome + CDP 打开
// 三个页面，直接从 DOM 里读断言，不靠「看起来对」。
// ⚠️ 用的是用户真实技能库与调用记录，截图里会出现真实技能名 / 本机路径 —— 只写进
//    output/final-check/shots/（已在 .gitignore 里），不要提交。
// 用法：npm run build && node output/final-check/verify-ui.mjs
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

const outDir = path.resolve("output/final-check/shots");
fs.mkdirSync(outDir, { recursive: true });

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(candidate => fs.existsSync(candidate));
if (!CHROME) throw new Error("找不到本机 Chrome / Edge");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  probe.on("error", reject);
});

const port = await freePort();
const debugPort = await freePort();
const profile = fs.mkdtempSync(path.join(process.env.TEMP ?? "/tmp", "final-check-"));
const server = spawn(process.execPath, ["backend/server.mjs", "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let log = "";
server.stdout.on("data", chunk => { log += chunk; });
server.stderr.on("data", chunk => { log += chunk; });

let chrome, ws;
const results = [];
const check = (label, ok, detail = "") => { results.push({ label, ok, detail }); console.log(`${ok ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`); };

try {
  const deadline = Date.now() + 25000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* 等就绪 */ }
    if (Date.now() > deadline) throw new Error(`服务未就绪：${log}`);
    await sleep(150);
  }
  chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--force-device-scale-factor=1", `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*",
    `--user-data-dir=${profile}`, "--window-size=1600,1000"], { stdio: "ignore" });
  let target = null;
  for (let index = 0; index < 160 && !target; index++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      target = list.find(item => item.type === "page" && item.webSocketDebuggerUrl);
    } catch { /* 等端口 */ }
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
    if (result.exceptionDetails) throw new Error(`表达式执行失败：${result.exceptionDetails.text}`);
    return result.result?.value;
  };
  const shoot = async name => {
    const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1600, height: 1000, scale: 1 } });
    fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(shot.data, "base64"));
  };
  const open = async (route, wait) => {
    await send("Page.navigate", { url: `http://127.0.0.1:${port}${route}` });
    await sleep(wait);
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });

  // ── A + B：调用记录页的徽章与触发方式 ──
  await open("/skill-activity", 7000);
  const chips = await evaluate(`(() => {
    const spans = [...document.querySelectorAll("span")];
    const text = value => spans.filter(s => s.textContent === value).length;
    return {
      total: document.querySelectorAll(".app-panel, [class*='rounded']").length,
      kindColored: spans.some(s => /bg-(indigo|teal|amber)-500\\/10/.test(s.className)),
      triggerColored: spans.some(s => /bg-(sky|accent)-/.test(s.className) || /bg-surface-hover/.test(s.className)),
      auto: text("自动触发"), manual: text("手动触发"), unknown: text("来源未知"),
      bodyHasRows: document.body.innerText.includes("调用记录"),
    };
  })()`);
  await shoot("activity");
  check("A 记录类型带底色徽章（indigo/teal/amber）", chips.kindColored, JSON.stringify(chips));
  check("A 触发方式带底色徽章", chips.triggerColored);
  check("B 列表里出现「自动触发」徽章", chips.auto > 0, `自动触发 ${chips.auto} / 手动触发 ${chips.manual} / 来源未知 ${chips.unknown}`);

  // ── C：安装页市场卡片的下载量 ──
  await open("/install", 8000);
  const market = await evaluate(`(() => {
    // 图标类名按「含 download」匹配：lucide 已把 DownloadCloud 改名为 CloudDownload，
    // 生成的 class 是 lucide-cloud-download，写死旧名会永远匹配不到。
    const icons = document.querySelectorAll('svg[class*="download"]').length;
    const trending = document.querySelectorAll('svg[class*="trending"]').length;
    const counts = [...document.querySelectorAll("span")].map(s => s.textContent.trim()).filter(t => /^[\\d.]+[KM]?$/.test(t));
    return { icons, trending, counts: counts.slice(0, 6), body: document.body.innerText.includes("浏览榜单") };
  })()`);
  await shoot("install");
  check("C 市场卡片显示下载量图标", market.icons > 0, `${market.icons} 个`);
  check("C 显示下载量数字", market.counts.length > 0, market.counts.join(" "));

  // ── D：技能详情「来源信息」里的 GitHub 仓库 ──
  await open("/my-skills", 5000);
  const opened = await evaluate(`(() => {
    const card = [...document.querySelectorAll(".app-panel")].find(el => el.textContent.includes("apple-design"));
    if (!card) return "not-found";
    card.click(); return "clicked";
  })()`);
  await sleep(3500);
  const detail = await evaluate(`(() => {
    const sidebar = document.querySelector(".skill-detail-sidebar");
    const scope = sidebar ?? document.body;
    return { hasSidebar: !!sidebar, repo: scope.textContent.includes("emilkowalski/skills"), sample: scope.textContent.slice(0, 0) };
  })()`);
  await shoot("skill-detail");
  check("D 技能详情「来源信息」显示上游 GitHub 仓库", detail.repo, `打开卡片=${opened} 右栏=${detail.hasSidebar}`);

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
  fs.writeFileSync(path.resolve("output/final-check/result.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  process.exitCode = failed.length ? 1 : 0;
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  try { chrome?.kill(); } catch { /* ignore */ }
  try { server.kill(); } catch { /* ignore */ }
  await sleep(300);
}
