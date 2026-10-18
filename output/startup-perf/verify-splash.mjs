// 首屏占位与启动链路的无头验证（真实应用 + 无头 Chrome/CDP）。
//
// 四段断言：
//   A 拦住 JS 包 → 只剩 HTML/内联样式，占位必须可见（深色）；
//   B 同上但主题设为 light → 占位必须切到浅色（html.boot-light）；
//   C 放开 JS → 占位出现后被移除、应用真的渲染、控制台无报错；
//   D 应用跑完后 boot-light 仍在（占位的主题类不与应用打架）。
// 用法：node output/startup-perf/verify-splash.mjs
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const REAL = path.join(os.homedir(), ".skills-manager");
const root = path.resolve("output/startup-perf");
// 每次跑用独立目录：沙箱里 rmSync 会走回收站且可能超时，干脆不删（data/ 已被 gitignore）。
const runTag = new Date().toISOString().replace(/[:.]/g, "-");
const home = path.join(root, "data", `run-${runTag}`);
const dir = path.join(home, ".skills-manager");
const evidence = path.join(root, "evidence", runTag);
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(evidence, { recursive: true });
fs.cpSync(REAL, dir, { recursive: true });

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(candidate => fs.existsSync(candidate));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  probe.on("error", reject);
});

const port = await freePort();
const debugPort = await freePort();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "boot-splash-profile-"));
const server = spawn(process.execPath,
  ["backend/server.mjs", "--port", String(port), "--directory", dir, "--home", home],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = "";
server.stdout.on("data", chunk => { serverLog += chunk; });
server.stderr.on("data", chunk => { serverLog += chunk; });

// 记录器：在任何页面脚本之前生效，记录占位出现的时刻/外观与消失的时刻。
const RECORDER = `
  window.__boot = { seen: false, firstSeenAt: null, removedAt: null, bg: null, hint: null };
  const sample = () => {
    const el = document.getElementById("boot-splash");
    if (el) {
      if (!window.__boot.seen) {
        window.__boot.seen = true;
        window.__boot.firstSeenAt = Math.round(performance.now());
        const style = getComputedStyle(el);
        window.__boot.bg = style.backgroundColor;
        const hint = el.querySelector(".boot-hint");
        window.__boot.hint = hint ? hint.textContent : null;
      }
    } else if (window.__boot.seen && window.__boot.removedAt === null) {
      window.__boot.removedAt = Math.round(performance.now());
    }
  };
  new MutationObserver(sample).observe(document, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", sample);
  sample();
`;

let chrome, ws;
const report = { runs: [], failures: [] };
const fail = message => report.failures.push(message);
try {
  const deadline = Date.now() + 20000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* 等 */ }
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
    } catch { /* 等端口 */ }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error("找不到可调试的页面目标");

  ws = new WebSocket(target.webSocketDebuggerUrl);
  if (ws.readyState !== 1) await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
  let seq = 0;
  const pending = new Map();
  let consoleErrors = [];
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      consoleErrors.push(message.params.args.map(arg => arg.value ?? arg.description).join(" "));
    }
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params.exceptionDetails;
      consoleErrors.push(details?.exception?.description ?? details?.text ?? "未知异常");
    }
    const entry = pending.get(message.id);
    if (entry) { pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); }
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params ?? {} }));
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`表达式执行失败：${result.exceptionDetails.text}`);
    return result.result?.value;
  };
  const shoot = async name => {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(shot.data, "base64"));
  };
  const snapshot = async () => JSON.parse(await evaluate(`JSON.stringify({
    boot: window.__boot,
    splashPresent: !!document.getElementById("boot-splash"),
    splashBg: document.getElementById("boot-splash") ? getComputedStyle(document.getElementById("boot-splash")).backgroundColor : null,
    markColor: document.querySelector("#boot-splash .boot-mark") ? getComputedStyle(document.querySelector("#boot-splash .boot-mark")).color : null,
    bootLightClass: document.documentElement.classList.contains("boot-light"),
    rootChildren: document.getElementById("root")?.children.length ?? 0,
    heading: document.querySelector("h1")?.textContent ?? null,
  })`));

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });

  const setTheme = async theme => {
    await evaluate(`localStorage.setItem("theme", ${JSON.stringify(theme)})`);
  };

  // 先正常载入一次，拿到同源上下文后再摆布主题与拦截。
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
  await sleep(2500);

  // ── A：拦住 JS 包，只剩 HTML + 内联样式，占位必须可见（深色）──
  await setTheme("dark");
  await send("Network.setBlockedURLs", { urls: ["*/assets/*.js"] });
  consoleErrors = [];
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
  await sleep(1200);
  const a = await snapshot();
  await shoot("A-splash-dark-jsblocked");
  report.runs.push({ name: "A 占位·深色（拦住 JS）", ...a, consoleErrors: [...consoleErrors] });
  if (!a.boot.seen || !a.splashPresent) fail("A: 拦住 JS 后首屏占位不可见");
  if (a.splashBg !== "rgb(13, 13, 15)") fail(`A: 深色占位底色异常 ${a.splashBg}`);
  if (a.markColor !== "rgb(230, 230, 234)") fail(`A: 深色占位标题被应用主题污染（应为浅色文字，实为 ${a.markColor}）`);
  if (a.boot.hint !== "正在启动本地服务…") fail(`A: 占位提示文案异常 ${a.boot.hint}`);

  // ── B：同样的拦截，主题切 light，占位必须跟随 ──
  await setTheme("light");
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
  await sleep(1200);
  const b = await snapshot();
  await shoot("B-splash-light-jsblocked");
  report.runs.push({ name: "B 占位·浅色（拦住 JS）", ...b });
  if (!b.boot.seen || !b.splashPresent) fail("B: 浅色下首屏占位不可见");
  if (!b.bootLightClass) fail("B: 主题为 light 时未给 <html> 加 boot-light");
  if (b.splashBg !== "rgb(247, 247, 249)") fail(`B: 浅色占位底色异常 ${b.splashBg}`);
  if (b.markColor !== "rgb(24, 24, 27)") fail(`B: 浅色占位标题颜色异常 ${b.markColor}`);

  // ── C：放开 JS，走完整启动流程 ──
  await setTheme("dark");
  await send("Network.setBlockedURLs", { urls: [] });
  consoleErrors = [];
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
  await sleep(3000);
  const c = await snapshot();
  await shoot("C-loaded-dark");
  report.runs.push({ name: "C 完整启动（放行 JS）", ...c, consoleErrors: [...consoleErrors] });
  if (!c.boot.seen) fail("C: 未观察到首屏占位出现");
  if (c.boot.removedAt === null) fail("C: 首屏占位没有被移除");
  if (c.splashPresent) fail("C: 数据落地后占位仍在");
  if (c.rootChildren < 1) fail(`C: 应用未渲染（#root 子节点 ${c.rootChildren}）`);
  if (!c.heading) fail("C: 未找到页面标题");
  if (consoleErrors.length) fail(`C: 控制台报错 ${consoleErrors.join(" | ")}`);

  // ── D：浅色主题走完整流程（主题类不被应用清掉、应用正常渲染）──
  await setTheme("light");
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
  await sleep(3000);
  const d = await snapshot();
  await shoot("D-loaded-light");
  report.runs.push({ name: "D 完整启动·浅色", ...d });
  if (!d.bootLightClass) fail("D: 浅色主题下 boot-light 丢失");
  if (d.rootChildren < 1) fail("D: 浅色下应用未渲染");

  // ── E：Electron 启动占位页本体（file://，独立于应用页面）──
  const splashUrl = "file:///" + path.resolve("electron/splash.html").replace(/\\/g, "/");
  await send("Network.setBlockedURLs", { urls: [] });
  await send("Page.navigate", { url: splashUrl });
  await sleep(600);
  const e = JSON.parse(await evaluate(`JSON.stringify({
    mark: document.querySelector(".boot-mark")?.textContent ?? null,
    hint: document.querySelector(".boot-hint")?.textContent ?? null,
    barColor: document.querySelector(".boot-bar > span") ? getComputedStyle(document.querySelector(".boot-bar > span")).backgroundColor : null,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    bootLightClass: document.documentElement.classList.contains("boot-light"),
  })`));
  await shoot("E-electron-splash-file");
  report.runs.push({ name: "E Electron 启动占位页（file://）", ...e });
  if (e.mark !== "Skills Manager") fail("E: 启动占位页标题异常");
  if (!e.hint) fail("E: 启动占位页缺少提示文案");
  if (e.bodyBg !== "rgb(13, 13, 15)") fail(`E: 启动占位页底色异常 ${e.bodyBg}`);

  report.ok = report.failures.length === 0;
  console.log(JSON.stringify(report, null, 2));
  console.log(report.ok ? "\n✅ 全部断言通过" : `\n❌ 断言失败：\n- ${report.failures.join("\n- ")}`);
  process.exitCode = report.ok ? 0 : 1;
} finally {
  try { fs.writeFileSync(path.join(evidence, "report.json"), JSON.stringify(report, null, 2)); } catch { /* ignore */ }
  try { ws?.close(); } catch { /* ignore */ }
  try { chrome?.kill(); } catch { /* ignore */ }
  try { server.kill(); } catch { /* ignore */ }
  await sleep(400);
}
