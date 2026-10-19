// 调用记录双栏独立滚动验收：隔离数据 + 真实后端 + 无头 Chrome。
// 覆盖：整页不滚、左列表与右详情各自滚动、滚轮各滚各的、窄窗口回退为整页滚动。
// 用法：node output/split-scroll/verify.mjs [tag]
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const tag = process.argv[2] ?? "run";
const root = path.resolve("output/split-scroll");
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

// 复用列宽验收那份数据（12 技能 / 40 条调用），保证列表确实需要滚动。
await new Promise((resolve, reject) => {
  const seeded = spawn(NODE, [path.resolve("output/column-widths/seed.mjs")], {
    stdio: "ignore", windowsHide: true, env: { ...process.env, COLWIDTH_DATA: dataRoot },
  });
  seeded.on("exit", code => (code === 0 ? resolve() : reject(new Error(`seed 失败：${code}`))));
});

const port = await freePort();
const debugPort = await freePort();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "split-scroll-profile-"));
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
      "--window-size=1600,900", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
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
  const goto = async url => { await send("Page.navigate", { url }); await sleep(2600); };
  const shoot = async name => {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(shot.data, "base64"));
  };
  const viewport = async (width, height) => {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await sleep(700);
  };
  const wheel = async (x, y, deltaY) => {
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY });
    await sleep(600);
  };

  // 页内三个滚动容器：外层页面、左列表、右详情
  const PROBE = `(() => {
    const outer = document.getElementById('page-scroll-container');
    const section = [...document.querySelectorAll('section[aria-label]')].find(el => el.querySelector('[role="tablist"]'));
    const aside = document.querySelector('aside');
    const listScroll = section.querySelector(':scope > div.min-h-0');
    const detailScroll = aside.querySelector(':scope > div.min-h-0');
    const box = (el) => el ? { scrollTop: Math.round(el.scrollTop), scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollable: el.scrollHeight > el.clientHeight + 1, top: Math.round(el.getBoundingClientRect().top), bottom: Math.round(el.getBoundingClientRect().bottom) } : null;
    return { outer: box(outer), list: box(listScroll), detail: box(detailScroll) };
  })()`;

  await send("Page.enable");
  await send("Runtime.enable");
  await goto(`http://127.0.0.1:${port}/`);
  await evaluate(`localStorage.setItem('theme','light'); localStorage.setItem('language','zh')`);

  // ── 1. 1600×700：列表与详情都超过可视高度 ──
  await viewport(1600, 700);
  await goto(`http://127.0.0.1:${port}/skill-activity`);
  // 选中第一条记录，让详情栏有内容
  await evaluate(`(() => { const row = [...document.querySelectorAll('[role="button"]')].find(el => el.getAttribute('aria-pressed') !== null); if (row) row.click(); return !!row; })()`);
  await sleep(900);

  const initial = await evaluate(PROBE);
  record("初始布局与三个滚动容器", initial);
  expect("整页没有滚动量（页面正好填满可视区）", initial.outer.scrollHeight <= initial.outer.clientHeight + 1, initial.outer);
  expect("左侧列表自身可滚动", initial.list?.scrollable === true, initial.list);
  expect("右侧详情自身可滚动", initial.detail?.scrollable === true, initial.detail);

  // 记录列表几何：页签固定在上、分页固定在下
  const geometry = await evaluate(`(() => {
    const section = [...document.querySelectorAll('section[aria-label]')].find(el => el.querySelector('[role="tablist"]'));
    const tabs = section.querySelector('[role="tablist"]');
    const footer = section.querySelector('footer');
    const listScroll = section.querySelector(':scope > div.min-h-0');
    return {
      tabsTop: Math.round(tabs.getBoundingClientRect().top),
      listTop: Math.round(listScroll.getBoundingClientRect().top),
      listBottom: Math.round(listScroll.getBoundingClientRect().bottom),
      footerTop: Math.round(footer.getBoundingClientRect().top),
      tabsInsideList: listScroll.contains(tabs),
      footerInsideList: listScroll.contains(footer),
    };
  })()`);
  record("页签与分页在滚动区之外", geometry);
  expect("页签与分页不随列表滚动", geometry.tabsInsideList === false && geometry.footerInsideList === false, geometry);

  // ── 2. 滚轮：在左列表滚动只动左列表 ──
  const leftPoint = await evaluate(`(() => { const el = [...document.querySelectorAll('section[aria-label]')].find(x => x.querySelector('[role="tablist"]')); const rect = el.getBoundingClientRect(); return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }; })()`);
  await wheel(leftPoint.x, leftPoint.y, 420);
  const afterLeftWheel = await evaluate(PROBE);
  record("左列表滚轮后", afterLeftWheel);
  expect("左列表滚轮只滚动左列表", afterLeftWheel.list.scrollTop > 0, afterLeftWheel.list.scrollTop);
  expect("左列表滚动时页面不动", afterLeftWheel.outer.scrollTop === 0, afterLeftWheel.outer.scrollTop);
  expect("左列表滚动时详情不动", afterLeftWheel.detail.scrollTop === initial.detail.scrollTop, { before: initial.detail.scrollTop, after: afterLeftWheel.detail.scrollTop });
  await shoot("01_left_scrolled");

  // ── 3. 滚轮：在右详情滚动只动右详情 ──
  const rightPoint = await evaluate(`(() => { const el = document.querySelector('aside'); const rect = el.getBoundingClientRect(); return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height * 0.7) }; })()`);
  await wheel(rightPoint.x, rightPoint.y, 420);
  const afterRightWheel = await evaluate(PROBE);
  record("右详情滚轮后", afterRightWheel);
  expect("右详情滚轮只滚动右详情", afterRightWheel.detail.scrollTop > afterLeftWheel.detail.scrollTop, { before: afterLeftWheel.detail.scrollTop, after: afterRightWheel.detail.scrollTop });
  expect("右详情滚动时页面不动", afterRightWheel.outer.scrollTop === 0, afterRightWheel.outer.scrollTop);
  expect("右详情滚动时左列表不动", afterRightWheel.list.scrollTop === afterLeftWheel.list.scrollTop, { before: afterLeftWheel.list.scrollTop, after: afterRightWheel.list.scrollTop });
  // 标题仍在原位
  const detailTitleFixed = await evaluate(`(() => {
    const aside = document.querySelector('aside');
    const heading = aside.querySelector('h2');
    const scroll = aside.querySelector(':scope > div.min-h-0');
    return { headingInsideScroll: scroll.contains(heading), headingTop: Math.round(heading.getBoundingClientRect().top) };
  })()`);
  record("详情标题不随滚动移动", detailTitleFixed);
  expect("详情标题固定在面板顶部", detailTitleFixed.headingInsideScroll === false, detailTitleFixed);
  await shoot("02_right_scrolled");

  // ── 4. 表头吸顶 ──
  const sticky = await evaluate(`(() => {
    const section = [...document.querySelectorAll('section[aria-label]')].find(el => el.querySelector('[role="tablist"]'));
    const scroll = section.querySelector(':scope > div.min-h-0');
    const head = scroll.querySelector('[role="presentation"]');
    return { position: getComputedStyle(head).position, top: Math.round(head.getBoundingClientRect().top), scrollTop: Math.round(scroll.scrollTop) };
  })()`);
  record("表头吸顶", sticky);
  expect("列头在列表滚动时吸顶", sticky.position === "sticky", sticky);

  // ── 5. 1080p 级别窗口：列表可视高度是否够用（约 5 行以上）──
  await viewport(1600, 950);
  await goto(`http://127.0.0.1:${port}/skill-activity`);
  await evaluate(`(() => { const row = [...document.querySelectorAll('[role="button"]')].find(el => el.getAttribute('aria-pressed') !== null); if (row) row.click(); return !!row; })()`);
  await sleep(800);
  const tall = await evaluate(`(() => {
    const section = [...document.querySelectorAll('section[aria-label]')].find(el => el.querySelector('[role="tablist"]'));
    const list = section.querySelector(':scope > div.min-h-0');
    const row = section.querySelector('[role="button"][aria-pressed]');
    const rowHeight = row ? row.getBoundingClientRect().height : 0;
    return { clientHeight: list.clientHeight, visibleRows: rowHeight ? Math.floor(list.clientHeight / rowHeight) : 0 };
  })()`);
  record("1600×950 列表可视行数", tall);
  expect("1080p 级别窗口列表至少 6 行", tall.visibleRows >= 6, tall);
  await shoot("04_1600x950");
  await viewport(1600, 700);

  // ── 6. 1024 以下回退为整页滚动 ──
  await viewport(900, 800);
  await goto(`http://127.0.0.1:${port}/skill-activity`);
  await sleep(600);
  const narrow = await evaluate(PROBE);
  record("窄窗口布局", narrow);
  expect("窄窗口仍由整页滚动", narrow.outer.scrollable === true && narrow.list?.scrollable === false, narrow);
  await shoot("03_narrow_page_scroll");
  await viewport(1600, 700);
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
  console.log(`\n✓ 全部 ${results.length} 项通过（证据：${path.relative(process.cwd(), evidence)}）`);
}
