// 调用记录「输入即筛选 + 每页 20 条 + 面板变高」验收：隔离数据 + 真实后端 + 无头 Chrome。
// 用法：node output/live-search/verify.mjs [tag]
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const tag = process.argv[2] ?? "run";
const root = path.resolve("output/live-search");
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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "live-search-profile-"));
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
  const type = async (text) => {
    for (const char of text) {
      await send("Input.dispatchKeyEvent", { type: "char", text: char });
      await sleep(60);
    }
  };

  const ROWS = `document.querySelectorAll('[role="button"][aria-pressed]').length`;
  const FOOTER = `(() => { const f = document.querySelector('section[aria-label] footer'); return f ? f.textContent.replace(/\\s+/g,' ').trim() : null; })()`;

  await send("Page.enable");
  await send("Runtime.enable");
  await goto(`http://127.0.0.1:${port}/`);
  await evaluate(`localStorage.setItem('theme','light'); localStorage.setItem('language','zh')`);
  await goto(`http://127.0.0.1:${port}/skill-activity`);

  // ── 1. 每页 20 条 + 查询按钮已移除 ──
  const firstPage = await evaluate(`({ rows: ${ROWS}, footer: ${FOOTER} })`);
  record("首屏列表与分页", firstPage);
  expect("每页 20 条", firstPage.rows === 20, firstPage.rows);
  expect("共 40 条分成 2 页", /共 40 条/.test(firstPage.footer ?? "") && /1 \/ 2/.test(firstPage.footer ?? ""), firstPage.footer);

  // ── 1b. 统计卡下方的口径说明整段删除 ──
  const stats = await evaluate(`(() => {
    const section = [...document.querySelectorAll('section[aria-label]')].find(el => el.querySelector('[class*="sm:grid-cols-4"]'));
    if (!section) return null;
    return {
      paragraphs: section.querySelectorAll('p').length,
      text: section.textContent.replace(/\\s+/g, " ").trim().slice(0, 160),
      height: Math.round(section.getBoundingClientRect().height),
    };
  })()`);
  record("统计区", stats);
  expect("统计区不再渲染口径说明", stats !== null && stats.paragraphs === 0 && !stats.text.includes("仅请求不计入实际使用"), stats);
  expect("整页文本也不含该句", !(await evaluate(`document.body.innerText.includes("仅请求不计入实际使用")`)), "body");

  const filterBar = await evaluate(`(() => {
    const panel = [...document.querySelectorAll('div.app-panel')].find(el => el.querySelector('input[aria-label]'));
    return {
      buttons: [...panel.querySelectorAll('button')].map(b => b.textContent.replace(/\\s+/g,' ').trim()).filter(Boolean),
      hasSubmit: !!panel.querySelector('button[type="submit"]'),
      isForm: panel.tagName.toLowerCase() === 'form',
    };
  })()`);
  record("筛选栏按钮", filterBar);
  expect("「查询」按钮已移除", !filterBar.buttons.includes("查询") && filterBar.hasSubmit === false && filterBar.isForm === false, filterBar);

  // ── 2. 输入即筛选（不点任何按钮） ──
  await evaluate(`(() => { const input = document.querySelector('input[aria-label="技能"]'); input.focus(); return document.activeElement === input; })()`);
  await type("beta");
  await sleep(900);
  const afterTyping = await evaluate(`({ rows: ${ROWS}, footer: ${FOOTER}, value: document.querySelector('input[aria-label="技能"]').value, names: [...document.querySelectorAll('[role="button"][aria-pressed]')].map(r => r.textContent.trim().slice(0, 24)) })`);
  record("输入 beta 后（未点按钮）", afterTyping);
  expect("输入即筛选：列表已按关键词收窄", afterTyping.rows > 0 && afterTyping.rows < 20, afterTyping.rows);
  expect("结果都命中关键词", afterTyping.names.every(text => text.includes("beta-review")), afterTyping.names);
  expect("输入框保留原值", afterTyping.value === "beta", afterTyping.value);
  await shoot("01_live_search");

  // ── 3. 清空后恢复 ──
  await evaluate(`(() => { const input = document.querySelector('input[aria-label="技能"]'); input.focus(); input.select(); return true; })()`);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
  await sleep(900);
  const afterClear = await evaluate(`({ rows: ${ROWS}, footer: ${FOOTER} })`);
  record("清空关键词后", afterClear);
  expect("清空后回到完整列表", afterClear.rows === 20 && /1 \/ 2/.test(afterClear.footer ?? ""), afterClear);

  // ── 4. 下拉即时生效 ──
  const selectFiltered = await evaluate(`(() => {
    const select = document.querySelector('select[aria-label="触发方式"]');
    select.value = 'automatic';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(900);
  const afterSelect = await evaluate(`({ rows: ${ROWS}, footer: ${FOOTER} })`);
  record("触发方式=自动触发", { selectFiltered, ...afterSelect });
  expect("下拉选择立即生效", afterSelect.rows > 0 && afterSelect.rows < 20, afterSelect.rows);

  // ── 5. 面板高度（压缩页头后）与详情栏宽度 ──
  await viewport(1600, 700);
  await goto(`http://127.0.0.1:${port}/skill-activity`);
  const heights700 = await evaluate(`(() => {
    const section = [...document.querySelectorAll('section[aria-label]')].find(el => el.querySelector('[role="tablist"]'));
    const list = section.querySelector(':scope > div.min-h-0');
    const aside = document.querySelector('aside');
    const row = section.querySelector('[role="button"][aria-pressed]');
    const rowHeight = row ? row.getBoundingClientRect().height : 0;
    return {
      list: list.clientHeight,
      detail: aside.getBoundingClientRect().height,
      detailWidth: Math.round(aside.getBoundingClientRect().width),
      pageScrollable: (() => { const o = document.getElementById('page-scroll-container'); return o.scrollHeight > o.clientHeight + 1; })(),
      visibleRows: rowHeight ? Math.floor(list.clientHeight / rowHeight) : 0,
    };
  })()`);
  record("1600×700 面板尺寸", heights700);
  // 改造前同一视口：列表 189、详情栏高 233（见 output/split-scroll/evidence/run）
  expect("列表可视高度比改造前更高（>240）", heights700.list > 240, heights700.list);
  expect("整页仍不滚动", heights700.pageScrollable === false, heights700.pageScrollable);
  await shoot("02_1600x700");

  await viewport(1600, 950);
  await goto(`http://127.0.0.1:${port}/skill-activity`);
  const heights950 = await evaluate(`(() => {
    const section = [...document.querySelectorAll('section[aria-label]')].find(el => el.querySelector('[role="tablist"]'));
    const list = section.querySelector(':scope > div.min-h-0');
    const aside = document.querySelector('aside');
    const row = section.querySelector('[role="button"][aria-pressed]');
    const rowHeight = row ? row.getBoundingClientRect().height : 0;
    return {
      list: list.clientHeight,
      detailWidth: Math.round(aside.getBoundingClientRect().width),
      visibleRows: rowHeight ? Math.floor(list.clientHeight / rowHeight) : 0,
    };
  })()`);
  record("1600×950 面板尺寸", heights950);
  // 1600 宽已进入 2xl 档，详情栏应为 560（xl 档 480 在 1280–1535 生效，下面单独验）。
  expect("详情栏在 1600 宽下为 560px", heights950.detailWidth === 560, heights950.detailWidth);
  await shoot("03_1600x950");

  await viewport(1400, 950);
  await goto(`http://127.0.0.1:${port}/skill-activity`);
  const midWidth = await evaluate(`(() => {
    const aside = document.querySelector('aside');
    const section = [...document.querySelectorAll('section[aria-label]')].find(el => el.querySelector('[role="tablist"]'));
    return { detailWidth: Math.round(aside.getBoundingClientRect().width), tableWidth: Math.round(section.getBoundingClientRect().width) };
  })()`);
  record("1400×950 栏宽", midWidth);
  expect("详情栏在 1400 宽下为 480px", midWidth.detailWidth === 480, midWidth.detailWidth);
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
