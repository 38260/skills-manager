// 页面级加载耗时画像：真实应用（真实技能库 + 真实调用记录副本）+ 无头 Chrome/CDP。
//
// 复刻用户的真实操作路径：先整页载入一次「工作台」，之后**用 history.pushState + popstate
// 切换路由**（和点侧栏完全同一条链路），逐页记录：
//   · mountMs  —— 切过去到该页外壳（h1）出现
//   · dataMs   —— 切过去到该页最后一个接口返回（数据到位）
//   · 该页触发的每个 /api/invoke 命令耗时与响应体大小
// 用法：node output/page-perf/probe.mjs
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const REAL_HOME = os.homedir();
const REAL_ACTIVITY = path.join(REAL_HOME, ".skills-manager-activity");
const root = path.resolve("output/page-perf");
const runTag = new Date().toISOString().replace(/[:.]/g, "-");
const home = path.join(root, "data", `run-${runTag}`);
const evidence = path.join(root, "evidence", runTag);
fs.mkdirSync(evidence, { recursive: true });
// 调用记录库用副本：来源路径（INSERT OR IGNORE 不会覆盖，见 activity/store.mjs）仍指向真实日志，
// 但扫描进度只写进副本，不动用户库。
fs.mkdirSync(path.join(home, ".skills-manager-activity"), { recursive: true });
fs.cpSync(REAL_ACTIVITY, path.join(home, ".skills-manager-activity"), { recursive: true });

// 技能库直接读真实目录：页面加载只读，不产生写入（库里的 .git 不存在，备份链路是空转）。
const LIBRARY = path.join(REAL_HOME, ".skills-manager");

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(candidate => fs.existsSync(candidate));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  probe.on("error", reject);
});

const ROUTES = [
  { path: "/my-skills", name: "技能库", match: "技能库" },
  { path: "/skill-activity", name: "调用记录", match: "调用记录" },
  { path: "/global-workspace", name: "全局工作区", match: "工作区" },
  { path: "/install", name: "安装 Skills", match: "安装" },
  { path: "/backup", name: "备份", match: "备份" },
  { path: "/settings", name: "设置", match: "设置" },
  { path: "/my-skills", name: "技能库（二次进入）", match: "技能库" },
];

const port = await freePort();
const debugPort = await freePort();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "page-perf-profile-"));
const server = spawn(process.execPath,
  ["backend/server.mjs", "--port", String(port), "--directory", LIBRARY, "--home", home],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = "";
server.stdout.on("data", chunk => { serverLog += chunk; });
server.stderr.on("data", chunk => { serverLog += chunk; });

let chrome, ws;
const report = { routes: [], scan: null, failures: [] };
try {
  const deadline = Date.now() + 20000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* 等 */ }
    if (Date.now() > deadline) throw new Error(`本地服务未就绪：${serverLog}`);
    await sleep(150);
  }

  chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*", `--user-data-dir=${profile}`,
    "--window-size=1600,1000", "about:blank"], { stdio: "ignore" });
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
  const inflight = new Map();
  let requests = [];
  let lastApiAt = 0;
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.method === "Network.requestWillBeSent") {
      const { requestId, request, timestamp } = message.params;
      if (request.url.includes("/api/invoke/")) {
        inflight.set(requestId, { command: request.url.split("/api/invoke/")[1].split("?")[0], start: timestamp });
        lastApiAt = Date.now();
      }
    }
    if (message.method === "Network.loadingFinished") {
      const entry = inflight.get(message.params.requestId);
      if (entry) {
        inflight.delete(message.params.requestId);
        requests.push({ ...entry, ms: (message.params.timestamp - entry.start) * 1000, bytes: message.params.encodedDataLength ?? 0 });
        lastApiAt = Date.now();
      }
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
  const waitFor = async (expression, timeout = 15000) => {
    const started = Date.now();
    for (;;) {
      const state = await evaluate(`JSON.stringify({ ok: !!(${expression}), now: Math.round(performance.now()) })`);
      const parsed = JSON.parse(state);
      if (parsed.ok) return { wall: Date.now() - started, pageNow: parsed.now };
      if (Date.now() - started > timeout) return null;
      await sleep(30);
    }
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");

  // 整页载入工作台
  const bootStarted = performance.now();
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
  const boot = await waitFor(`document.querySelector("h1") && document.querySelector("h1").textContent.includes("工作台")`);
  report.firstLoad = { ms: Math.round(performance.now() - bootStarted), pageNow: boot?.pageNow ?? null };
  await sleep(1200);

  const h1Text = `(document.querySelector("h1")?.textContent ?? "")`;
  for (const route of ROUTES) {
    requests = [];
    lastApiAt = 0;
    const started = Date.now();
    await evaluate(`(() => { window.history.pushState(null, "", ${JSON.stringify(route.path)}); window.dispatchEvent(new PopStateEvent("popstate")); })()`);
    const mount = await waitFor(`${h1Text}.includes(${JSON.stringify(route.match)})`);
    // 数据到位：该页触发的接口都回来了，且 500ms 内没有新请求（视为这一页要的数据已齐）
    let dataMs = null;
    for (let index = 0; index < 150; index++) {
      await sleep(100);
      if (inflight.size === 0 && lastApiAt && Date.now() - lastApiAt > 500) { dataMs = lastApiAt - started; break; }
    }
    const rowCount = await evaluate(`document.querySelectorAll('[role="row"],[role="listitem"],table tbody tr').length`);
    report.routes.push({
      name: route.name, path: route.path,
      mountMs: mount?.wall ?? null,
      dataMs,
      rows: rowCount,
      apiCalls: requests.map(item => ({ command: item.command, ms: Math.round(item.ms), kb: Math.round(item.bytes / 102.4) / 10 })),
      h1: await evaluate(h1Text),
    });
    await sleep(300);
  }

  // 扫描是否还在跑（在跑的话上面的耗时会被 I/O 竞争影响）
  report.scan = await (await fetch(`http://127.0.0.1:${port}/api/invoke/get_skill_activity_sources`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-skills-manager-client": "webview" }, body: "{}",
  })).json();
  report.scan = report.scan.ok ? { running: report.scan.data.running, files: report.scan.data.sources.map(item => `${item.tool}:${item.files ?? 0}/${item.state}`) } : report.scan;

  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failures.push(error.message);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(evidence, "report.json"), JSON.stringify(report, null, 2));
  try { ws?.close(); } catch { /* ignore */ }
  try { chrome?.kill(); } catch { /* ignore */ }
  try { server.kill(); } catch { /* ignore */ }
  await sleep(400);
}
