// 用隔离技能库测量技能详情滚动的主线程耗时和掉帧。
// 用法：node output/detail-scroll-perf/measure.mjs <tag> [mixed|code] [detail|page]
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const tag = process.argv[2] ?? "baseline";
const profile = process.argv[3] ?? "mixed";
const surface = process.argv[4] ?? "detail";
const root = path.resolve("output/detail-scroll-perf");
const runId = `run-${tag}-${Date.now()}`;
const dataRoot = path.join(root, "data", runId);
const home = path.join(dataRoot, "home");
const reportPath = path.join(root, `${tag}.json`);

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(candidate => fs.existsSync(candidate));
if (!CHROME) throw new Error("找不到 Chrome/Edge");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  probe.on("error", reject);
});

const port = await freePort();
const debugPort = await freePort();
const chromeProfile = fs.mkdtempSync(path.join(os.tmpdir(), "detail-scroll-perf-"));

await new Promise((resolve, reject) => {
  const seeded = spawn(process.execPath, [path.join(root, "seed.mjs")], {
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    env: { ...process.env, DETAIL_SCROLL_PERF_DATA: dataRoot, DETAIL_SCROLL_PERF_PROFILE: profile },
  });
  let log = "";
  seeded.stdout.on("data", chunk => { log += chunk; });
  seeded.stderr.on("data", chunk => { log += chunk; });
  seeded.on("exit", code => (code === 0 ? resolve() : reject(new Error(`seed 失败：exit ${code}\n${log}`))));
});

const server = spawn(process.execPath, [
  "backend/server.mjs", "--port", String(port),
  "--directory", path.join(home, ".skills-manager"), "--home", home,
], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = "";
server.stdout.on("data", chunk => { serverLog += chunk; });
server.stderr.on("data", chunk => { serverLog += chunk; });

const invoke = (command, args = {}) => fetch(`http://127.0.0.1:${port}/api/invoke/${command}`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-skills-manager-client": "webview" },
  body: JSON.stringify(args),
}).then(async response => {
  const payload = await response.json();
  if (!payload?.ok) throw new Error(`${command}: ${payload?.message ?? response.status}`);
  return payload.data;
});

let chrome;
let ws;
let result;
try {
  const deadline = Date.now() + 20000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* 等 */ }
    if (Date.now() > deadline) throw new Error(`本地服务未就绪：${serverLog}`);
    await sleep(150);
  }

  await invoke("set_settings", { key: "language", value: "zh" });
  await invoke("set_settings", { key: "theme", value: "light" });

  chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*",
    `--user-data-dir=${chromeProfile}`, "--window-size=1536,1024", "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let chromeLog = "";
  chrome.stdout.on("data", chunk => { chromeLog += chunk; });
  chrome.stderr.on("data", chunk => { chromeLog += chunk; });

  let target = null;
  for (let index = 0; index < 80 && !target; index++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      target = list.find(item => item.type === "page" && item.webSocketDebuggerUrl);
    } catch { /* 等 */ }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error(`找不到可调试页面：${chromeLog.slice(0, 400)}`);

  ws = new WebSocket(target.webSocketDebuggerUrl);
  if (ws.readyState !== 1) await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params ?? {} }));
  });
  const evaluate = async (expression, awaitPromise = false) => {
    const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result?.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/${surface === "page" ? "dashboard" : "my-skills"}` });
  await sleep(2500);
  await evaluate(`localStorage.setItem('language','zh'); localStorage.setItem('theme','light')`);
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/${surface === "page" ? "dashboard" : "my-skills"}` });
  await sleep(2500);

  const opened = surface === "page" ? true : await evaluate(`(async () => {
    const waitFor = async (test, tries) => {
      for (let index = 0; index < tries; index++) {
        const value = test();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      return null;
    };
    const card = await waitFor(() => [...document.querySelectorAll('.app-panel')]
      .find(element => element.textContent.includes('detail-scroll-perf')), 60);
    if (!card) return false;
    card.click();
    return !!(await waitFor(() => document.querySelector('.skill-detail-shell'), 60));
  })()`, true);
  if (!opened) throw new Error("未能打开隔离技能详情");
  await sleep(1200);

  const dom = await evaluate(`(() => {
    const shell = document.querySelector('.skill-detail-shell');
    const main = shell?.querySelector('.skill-detail-main');
    const article = main?.querySelector('article');
    const codeBody = article?.querySelector('.skill-detail-code-body');
    const codeLine = codeBody?.querySelector('code');
    const codeBodyStyle = codeBody ? getComputedStyle(codeBody) : null;
    const codeLineStyle = codeLine ? getComputedStyle(codeLine) : null;
    return {
      headingCount: article?.querySelectorAll('h1,h2,h3').length ?? 0,
      elementCount: article?.querySelectorAll('*').length ?? 0,
      scrollHeight: main?.scrollHeight ?? 0,
      clientHeight: main?.clientHeight ?? 0,
      codeLines: codeLine?.textContent?.split('\\n').length ?? 0,
      codeLineHeight: codeLineStyle ? Math.round(parseFloat(codeLineStyle.lineHeight)) : 0,
      codeCounterReset: codeBodyStyle?.getPropertyValue('counter-reset').trim() ?? '',
      codeDisplay: codeLineStyle?.display ?? '',
    };
  })()`);

  const metrics = await evaluate(`(async () => {
    const shell = document.querySelector('.skill-detail-shell');
    const main = shell?.querySelector('.skill-detail-main');
    const target = main ?? document.getElementById('page-scroll-container');
    if (!target) return { error: 'scroll-target-not-found' };

    let reactRenders = 0;
    const rootElement = document.getElementById('root');
    const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (hook) {
      const rendererIds = [...hook.renderers.keys()];
      for (const id of rendererIds) {
        try { hook.getFiberRoots(id).forEach(root => { root.memoizedState; }); } catch { /* ignore */ }
        const original = hook.onCommitFiberRoot;
        hook.onCommitFiberRoot = function(...args) {
          reactRenders += 1;
          return original?.apply(this, args);
        };
      }
    }

    const frameDeltas = [];
    const longTasks = [];
    let lastFrame = performance.now();
    let running = true;
    const frameLoop = timestamp => {
      if (!running) return;
      frameDeltas.push(timestamp - lastFrame);
      lastFrame = timestamp;
      requestAnimationFrame(frameLoop);
    };
    requestAnimationFrame(frameLoop);
    let observer;
    if ('PerformanceObserver' in window) {
      try {
        observer = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) longTasks.push(entry.duration);
        });
        observer.observe({ type: 'longtask', buffered: false });
      } catch { /* ignore */ }
    }

    const started = performance.now();
    const max = target.scrollHeight - target.clientHeight;
    const steps = 120;
    for (let index = 0; index <= steps; index++) {
      target.scrollTop = max * (index / steps);
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    running = false;
    observer?.disconnect();
    const elapsed = performance.now() - started;
    target.scrollTop = 0;
    await new Promise(resolve => requestAnimationFrame(resolve));

    const sorted = frameDeltas.slice(1).sort((a, b) => a - b);
    const percentile = ratio => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
    return {
      elapsedMs: Number(elapsed.toFixed(1)),
      frames: frameDeltas.length,
      fps: Number(((frameDeltas.length - 1) / (elapsed / 1000)).toFixed(1)),
      averageFrameMs: Number((((frameDeltas.length - 1) / (elapsed / 1000))).toFixed(1)),
      p95FrameMs: Number(percentile(0.95).toFixed(1)),
      maxFrameMs: Number((sorted.at(-1) ?? 0).toFixed(1)),
      slowFrames: sorted.filter(value => value > 20).length,
      longTasks: longTasks.length,
      longTaskMs: Number(longTasks.reduce((sum, value) => sum + value, 0).toFixed(1)),
      reactRenders,
      target: main ? 'detail' : 'page',
      scrollHeight: target.scrollHeight,
    };
  })()`, true);

  result = { tag, profile, surface, runId, dom, metrics };
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  if (chrome) { try { chrome.kill(); } catch { /* ignore */ } }
  if (server) { try { server.kill(); } catch { /* ignore */ } }
}

fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
