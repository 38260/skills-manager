// 调用记录「详情栏拉长」验收：隔离数据 + 真实后端 + 无头 Chrome。
// 用法：node output/detail-height/verify.mjs [tag]
// 基线（改造前，tag=note-removed）：1600×950 详情栏高 = 列表高（约 547），1600×700 约 297。
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const tag = process.argv[2] ?? "run";
const root = path.resolve("output/detail-height");
const dataRoot = path.join(root, "data", `run-${tag}-${Date.now()}`);
const home = path.join(dataRoot, "home");
const evidence = path.join(root, "evidence", tag);
fs.mkdirSync(evidence, { recursive: true });

const NODE = process.execPath;
const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(candidate => fs.existsSync(candidate));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  probe.on("error", reject);
});

const failures = [];
const results = [];
const record = (name, value) => { results.push({ name, value }); console.log(`· ${name}: ${JSON.stringify(value)}`); };
const expect = (name, condition, detail) => {
  if (condition) record(name, detail ?? "ok");
  else { failures.push({ name, detail }); record(name, { FAILED: detail }); }
};

// 复用列宽验收那份数据：12 个技能、40 条调用记录。
await new Promise((resolve, reject) => {
  const seeded = spawn(NODE, [path.resolve("output/column-widths/seed.mjs")], {
    stdio: "ignore", windowsHide: true, env: { ...process.env, COLWIDTH_DATA: dataRoot },
  });
  seeded.on("exit", code => (code === 0 ? resolve() : reject(new Error(`seed 失败：${code}`))));
});

const port = await freePort();
const debugPort = await freePort();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "detail-height-profile-"));
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
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* 等待 */ }
    if (Date.now() > deadline) throw new Error(`服务未就绪：${serverLog}`);
    await sleep(150);
  }

  let target = null;
  let chromeLog = "";
  for (let attempt = 0; attempt < 2 && !target; attempt++) {
    if (chrome) { try { chrome.kill(); } catch { /* ignore */ } }
    const attemptPort = attempt === 0 ? debugPort : await freePort();
    chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run",
      `--remote-debugging-port=${attemptPort}`, "--remote-allow-origins=*", `--user-data-dir=${profile}`,
      "--window-size=1600,950", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
    chrome.stdout.on("data", chunk => { chromeLog += chunk; });
    chrome.stderr.on("data", chunk => { chromeLog += chunk; });
    for (let index = 0; index < 60 && !target; index++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${attemptPort}/json/list`)).json();
        target = list.find(item => item.type === "page" && item.webSocketDebuggerUrl);
      } catch { /* 等端口 */ }
      if (!target) await sleep(250);
    }
  }
  if (!target) throw new Error(`找不到可调试的页面目标：${chromeLog.slice(0, 300)}`);

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
  const goto = async url => { await send("Page.navigate", { url }); await sleep(2800); };
  const shoot = async name => {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(shot.data, "base64"));
  };
  const viewport = async (width, height) => {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await sleep(700);
  };

  // 一次量全：详情栏、列表、统计卡、筛选栏的位置与高度，以及详情正文的可视/内容高度。
  const MEASURE = `(() => {
    const section = [...document.querySelectorAll('section[aria-label]')].find(el => el.querySelector('[role="tablist"]'));
    const list = section.querySelector(':scope > div.min-h-0');
    const aside = document.querySelector('aside');
    const body = aside.querySelector(':scope > div.min-h-0');
    const stats = [...document.querySelectorAll('section[aria-label]')].find(el => el.querySelector('[class*="sm:grid-cols-4"]'));
    const filter = [...document.querySelectorAll('div.app-panel')].find(el => el.querySelector('input[aria-label]'));
    const grid = filter?.parentElement ?? null;
    const row = section.querySelector('[role="button"][aria-pressed]');
    const rect = el => el ? el.getBoundingClientRect() : null;
    const round = value => Math.round(value);
    return {
      detail: round(rect(aside).height),
      detailTop: round(rect(aside).top),
      detailWidth: round(rect(aside).width),
      detailBody: body ? body.clientHeight : null,
      detailContent: body ? body.scrollHeight : null,
      list: list.clientHeight,
      statsTop: stats ? round(rect(stats).top) : null,
      statsHeight: stats ? round(rect(stats).height) : null,
      filterHeight: filter ? round(rect(filter).height) : null,
      filterWidth: filter ? round(rect(filter).width) : null,
      gridWidth: grid ? round(rect(grid).width) : null,
      filterTop: filter ? round(rect(filter).top) : null,
      visibleRows: row ? Math.floor(list.clientHeight / rect(row).height) : 0,
      pageScrollable: (() => { const o = document.getElementById('page-scroll-container'); return o.scrollHeight > o.clientHeight + 1; })(),
    };
  })()`;

  await send("Page.enable");
  await send("Runtime.enable");
  await goto(`http://127.0.0.1:${port}/`);
  await evaluate(`localStorage.setItem('theme','light'); localStorage.setItem('language','zh')`);

  // ── 1. 1600×950 ──
  await viewport(1600, 950);
  await goto(`http://127.0.0.1:${port}/skill-activity`);
  const tall = await evaluate(MEASURE);
  record("1600×950", tall);
  // 基线：改造前详情栏与列表都只有 547 / 列表可视 9 行；现在两边都要更长。
  expect("详情栏明显高于改造前（≥700）", tall.detail >= 700, tall.detail);
  expect("列表滚动区比改造前更高（≥560）", tall.list >= 560, tall.list);
  expect("筛选栏整宽单行（高度 ≤64 且占满栅格）", tall.filterHeight <= 64 && Math.abs(tall.filterWidth - tall.gridWidth) <= 2, { filter: tall.filterHeight, filterWidth: tall.filterWidth, grid: tall.gridWidth });
  expect("筛选栏在统计卡上方（整宽第一行）", tall.filterTop < tall.statsTop, { filterTop: tall.filterTop, statsTop: tall.statsTop });
  expect("详情栏顶部与统计卡顶部对齐", Math.abs(tall.detailTop - tall.statsTop) <= 2, { detailTop: tall.detailTop, statsTop: tall.statsTop });
  expect("详情栏比列表高出「统计卡 + 行距」", tall.detail - tall.list >= tall.statsHeight, { detail: tall.detail, list: tall.list, stats: tall.statsHeight });
  expect("列表可见行数 ≥10（改造前 9）", tall.visibleRows >= 10, { visibleRows: tall.visibleRows, list: tall.list });
  expect("整页仍不滚动（950 高）", tall.pageScrollable === false, tall.pageScrollable);
  expect("详情栏宽度仍为 560", tall.detailWidth === 560, tall.detailWidth);
  await shoot("01_1600x950");

  // ── 2. 1600×700 ──
  await viewport(1600, 700);
  await goto(`http://127.0.0.1:${port}/skill-activity`);
  const short = await evaluate(MEASURE);
  record("1600×700", short);
  // 改造前同视口：列表 297、详情栏 297、可见 5 行。现在两边都比那时长。
  expect("详情栏在 700 高下仍 ≥400", short.detail >= 400, short.detail);
  expect("列表在 700 高下超过改造前（≥320）", short.list >= 320, short.list);
  expect("700 高下可见行数 ≥6（改造前 5）", short.visibleRows >= 6, short.visibleRows);
  expect("整页仍不滚动（700 高）", short.pageScrollable === false, short.pageScrollable);
  await shoot("02_1600x700");

  // ── 3. 1400 宽仍走 xl 档 ──
  await viewport(1400, 950);
  await goto(`http://127.0.0.1:${port}/skill-activity`);
  const mid = await evaluate(MEASURE);
  record("1400×950", mid);
  expect("1400 宽：详情栏 480px", mid.detailWidth === 480, mid.detailWidth);
  expect("1400 宽：筛选栏同样单行", mid.filterHeight <= 64, mid.filterHeight);
  expect("1400 宽：列表也比改造前更长（≥520）", mid.list >= 520, mid.list);
  await shoot("03_1400x950");

  // ── 4. 窄屏（<lg）回退成单列整页滚动 ──
  await viewport(900, 950);
  await goto(`http://127.0.0.1:${port}/skill-activity`);
  const narrow = await evaluate(`(() => {
    const aside = document.querySelector('aside');
    const section = [...document.querySelectorAll('section[aria-label]')].find(el => el.querySelector('[role="tablist"]'));
    return {
      asideWidth: Math.round(aside.getBoundingClientRect().width),
      stacked: Math.round(aside.getBoundingClientRect().top) > Math.round(section.getBoundingClientRect().bottom) - 2,
      pageScrollable: (() => { const o = document.getElementById('page-scroll-container'); return o.scrollHeight > o.clientHeight + 1; })(),
    };
  })()`);
  record("900×950（单列回退）", narrow);
  expect("窄屏详情栏排到列表下方", narrow.stacked === true, narrow);
  expect("窄屏回到整页滚动", narrow.pageScrollable === true, narrow.pageScrollable);
  await shoot("04_900x950");
} catch (error) {
  failures.push({ name: "脚本异常", detail: String(error?.stack ?? error) });
  console.error(`✗ 脚本异常：${error?.message ?? error}`);
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  try { chrome?.kill(); } catch { /* ignore */ }
  try { server.kill(); } catch { /* ignore */ }
}

const report = { tag, at: new Date().toISOString(), failures, results };
fs.writeFileSync(path.join(evidence, "report.json"), JSON.stringify(report, null, 2));
if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} 项未通过：`);
  for (const failure of failures) console.error(`  - ${failure.name}: ${JSON.stringify(failure.detail)}`);
  process.exitCode = 1;
} else {
  console.log(`\n✓ 全部 ${results.length} 项通过（证据：${evidence}）`);
}
