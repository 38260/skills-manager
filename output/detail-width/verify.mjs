// 真实库验收：正文跟随主区自适应、右侧只显示「中文版」、缺译本走角标。
// 用法：node output/detail-width/verify.mjs [tag]
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const tag = process.argv[2] ?? "run";
const root = path.resolve("output/detail-width");
const evidence = path.join(root, "evidence", tag);
fs.mkdirSync(evidence, { recursive: true });

const NODE = process.execPath;
const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  probe.on("error", reject);
});

const port = await freePort();
const debugPort = await freePort();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "detail-width-verify-"));
const home = os.homedir();
const failures = [];
const results = [];
const record = (name, value) => { results.push({ name, value }); console.log(`· ${name}: ${JSON.stringify(value)}`); };
// detail 可能是 false / "" 这类假值，不能用 `??` 兜底，否则失败会被静默判成成功。
const expect = (name, condition, detail) => {
  if (condition) record(name, detail === undefined ? "ok" : detail);
  else { failures.push({ name, detail }); record(name, { FAILED: detail }); }
};

const server = spawn(NODE, ["backend/server.mjs", "--port", String(port), "--directory", path.join(home, ".skills-manager"), "--home", home],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = "";
server.stdout.on("data", c => { serverLog += c; });
server.stderr.on("data", c => { serverLog += c; });

const invoke = (command, args = {}) => fetch(`http://127.0.0.1:${port}/api/invoke/${command}`, {
  method: "POST", headers: { "content-type": "application/json", "x-skills-manager-client": "webview" }, body: JSON.stringify(args),
}).then(async r => { const p = await r.json(); if (!p?.ok) throw new Error(`${command}: ${p?.message}`); return p.data; });

let chrome, ws;
try {
  const deadline = Date.now() + 25000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* wait */ }
    if (Date.now() > deadline) throw new Error(`服务未就绪：${serverLog}`);
    await sleep(200);
  }

  let target = null, chromeLog = "";
  for (let attempt = 0; attempt < 2 && !target; attempt++) {
    if (chrome) { try { chrome.kill(); } catch { /* ignore */ } }
    const attemptPort = attempt === 0 ? debugPort : await freePort();
    chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", `--remote-debugging-port=${attemptPort}`,
      "--remote-allow-origins=*", `--user-data-dir=${profile}`, "--window-size=1600,1000", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
    chrome.stderr.on("data", c => { chromeLog += c; });
    for (let i = 0; i < 60 && !target; i++) {
      try { const list = await (await fetch(`http://127.0.0.1:${attemptPort}/json/list`)).json(); target = list.find(x => x.type === "page" && x.webSocketDebuggerUrl); } catch { /* wait */ }
      if (!target) await sleep(250);
    }
  }
  if (!target) throw new Error(`找不到页面目标：${chromeLog.slice(0, 300)}`);

  ws = new WebSocket(target.webSocketDebuggerUrl);
  if (ws.readyState !== 1) await new Promise(r => ws.addEventListener("open", r, { once: true }));
  let seq = 0; const pending = new Map();
  ws.addEventListener("message", e => { const m = JSON.parse(e.data); const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } });
  const send = (method, params) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params: params ?? {} })); });
  const evaluate = async (expression, awaitPromise = false) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error(`表达式失败：${r.exceptionDetails.text}`);
    return r.result?.value;
  };
  const goto = async url => { await send("Page.navigate", { url }); await sleep(2800); };
  const shoot = async name => { const s = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(s.data, "base64")); };
  const viewport = async (w, h) => { await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await sleep(700); };

  await send("Page.enable"); await send("Runtime.enable");
  await invoke("set_settings", { key: "theme", value: "light" });
  await goto(`http://127.0.0.1:${port}/`);
  await evaluate(`localStorage.setItem('theme','light'); localStorage.setItem('language','zh')`);
  await goto(`http://127.0.0.1:${port}/my-skills`);

  const openDetail = name => evaluate(`(async () => {
    const waitFor = async (t, n) => { for (let i = 0; i < n; i++) { const v = t(); if (v) return v; await new Promise(r => setTimeout(r, 200)); } return null; };
    const card = await waitFor(() => [...document.querySelectorAll('.app-panel')].find(el => el.textContent.includes(${JSON.stringify(name)}) && el.getBoundingClientRect().width > 0), 60);
    if (!card) return false;
    card.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 200)); card.click();
    return !!(await waitFor(() => document.querySelector('.skill-detail-shell'), 50));
  })()`, true);

  const opened = await openDetail("apple-design");
  expect("打开真实技能 apple-design", opened === true, opened);
  await sleep(1500);

  const LAYOUT = `(() => {
    const shell = document.querySelector('.skill-detail-shell');
    if (!shell) return { missing: true };
    const rect = n => { const b = n.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width), right: Math.round(b.right), y: Math.round(b.y) }; };
    const main = shell.querySelector('.skill-detail-main');
    const article = main?.querySelector('article');
    const row = shell.querySelector('nav[aria-label]')?.parentElement;
    const ctrl = row?.querySelector('[role="group"]')?.parentElement;
    // 按钮里可能带角标（如「中文版」+ 缺译角标），label 只取首个子文本节点，text 保留完整串
    const buttons = ctrl ? [...ctrl.querySelectorAll('button')].map(b => {
      const first = b.firstChild;
      return {
        text: b.textContent.trim(),
        label: first && first.nodeType === 3 ? first.textContent.trim() : b.textContent.trim(),
        pressed: b.getAttribute('aria-pressed'),
      };
    }) : [];
    const inner = shell.querySelector('.skill-detail-main')?.firstElementChild;
    const nav = shell.querySelector('nav[aria-label]');
    const tabs = nav ? [...nav.querySelectorAll('button')].map(b => ({ text: b.textContent.trim(), right: Math.round(b.getBoundingClientRect().right) })) : [];
    // 目录项：侧栏 TOC 面板的 nav；正文标题：正文里真实渲染的 h2/h3
    const tocNav = shell.querySelector('aside nav[aria-label]');
    const tocItems = tocNav ? [...tocNav.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean) : [];
    // 正文标题取 h1-h3：extractHeadings 也是这个口径，且首个与技能名重复的 h1 会被正文隐藏
    const bodyHeadings = main ? [...main.querySelectorAll('h1,h2,h3')].map(h => h.textContent.trim()).filter(Boolean) : [];
    // 目录里每一条都要能在正文标题中找到（双向包含，容忍渲染时的空白/标点差异）
    const tocMissing = tocItems.filter(item => !bodyHeadings.some(h => h === item || h.includes(item) || item.includes(h)));
    return {
      tocCount: tocItems.length,
      tocSample: tocItems.slice(0, 4),
      tocMissing: tocMissing.slice(0, 3),
      bodyHeadingCount: bodyHeadings.length,
      bodyHeadingSample: bodyHeadings.slice(0, 4),
      tocInBody: tocItems.length > 0 && tocMissing.length === 0,
      main: rect(main), article: article ? rect(article) : null,
      leftGap: article && main ? Math.round(article.getBoundingClientRect().x - main.getBoundingClientRect().x) : null,
      rightGap: article && main ? Math.round(main.getBoundingClientRect().right - article.getBoundingClientRect().right) : null,
      ctrl: ctrl ? rect(ctrl) : null,
      tabs,
      tabToCtrlGap: ctrl && tabs.length ? Math.round(ctrl.getBoundingClientRect().x - tabs[tabs.length - 1].right) : null,
      buttons,
      innerWidth,
      noticeRow: !!inner && /\u6682\u65e0\u4e2d\u6587\u7248/.test(inner.textContent),
    };
  })()`;

  const layout = await evaluate(LAYOUT);
  record("1600 宽布局", layout);
  expect("详情面板可定位", layout?.missing !== true, layout);
  // 正文两侧只保留主区自身内边距（左 48 / 右 32），不再额外留出 860px 上限的空档
  expect("正文左留白收敛到主区内边距", layout && layout.leftGap <= 52, layout && { leftGap: layout.leftGap });
  expect("正文右留白收敛到主区内边距", layout && layout.rightGap <= 36, layout && { rightGap: layout.rightGap });
  expect("正文实际宽度随主区变化（不再固定 860）", layout && layout.article && layout.main && layout.main.w - layout.article.w < 90, layout && { main: layout.main.w, article: layout.article && layout.article.w });
  expect("右侧只显示「中文版」与「English」", layout?.buttons && layout.buttons.some(b => b.label === "中文版") && layout.buttons.some(b => b.label === "English"), layout?.buttons);
  expect("有译本时中文版默认选中", layout?.buttons?.find(b => b.label === "中文版")?.pressed === "true", layout?.buttons);
  // 目录必须与正文同源：默认中文版且已有译本时，目录应是中文且能在正文标题里逐条找到
  expect("目录非空且与正文标题一致（有中文译本）",
    layout?.tocCount > 0 && layout?.tocInBody === true,
    layout && { tocCount: layout.tocCount, tocSample: layout.tocSample, tocMissing: layout.tocMissing, bodyHeadingCount: layout.bodyHeadingCount, bodyHeadingSample: layout.bodyHeadingSample });
  // 目录比正文少 0~1 条属于正常：首个与技能名重复的 h1 不进目录，正文也可能隐藏它
  expect("目录与正文标题数量一致（差值 ≤1）", layout?.tocCount > 0 && Math.abs(layout.tocCount - layout.bodyHeadingCount) <= 1,
    layout && { tocCount: layout.tocCount, bodyHeadingCount: layout.bodyHeadingCount, tocMissing: layout.tocMissing });
  expect("右侧按钮文案为 English（不再是「英文原文」）",
    layout?.buttons?.some(b => b.label === "English") && !layout?.buttons?.some(b => b.text.includes("英文原文")),
    layout?.buttons?.map(b => b.label));
  await shoot("01_wide_1600");

  // 切到 English：正文与目录一起切到英文，目录不能消失、也不能和正文对不上
  const clickLanguage = label => evaluate(`(() => {
    const row = document.querySelector('.skill-detail-shell nav[aria-label]')?.parentElement;
    const ctrl = row?.querySelector('[role="group"]')?.parentElement;
    const btn = [...(ctrl?.querySelectorAll('button') ?? [])].find(b => b.textContent.trim().startsWith(${JSON.stringify(label)}));
    if (!btn) return false;
    btn.click(); return true;
  })()`);
  expect("点击 English 按钮", (await clickLanguage("English")) === true, true);
  await sleep(1600);
  const en = await evaluate(LAYOUT);
  record("English 布局", en);
  expect("切到 English：目录非空且与正文标题一致", en?.tocCount > 0 && en?.tocInBody === true,
    en && { tocCount: en.tocCount, tocSample: en.tocSample, tocMissing: en.tocMissing, bodyHeadingSample: en.bodyHeadingSample });
  expect("切到 English：English 选中、中文版未选中",
    en?.buttons?.find(b => b.label === "English")?.pressed === "true" && en?.buttons?.find(b => b.label === "中文版")?.pressed === "false",
    en?.buttons);
  await shoot("05_english_1600");

  expect("点击中文版按钮", (await clickLanguage("中文版")) === true, true);
  await sleep(1600);
  const back = await evaluate(LAYOUT);
  record("切回中文版布局", back);
  expect("切回中文版：目录恢复为中文且与正文一致", back?.tocInBody === true && back?.tocCount > 0,
    back && { tocCount: back.tocCount, tocSample: back.tocSample, tocMissing: back.tocMissing });
  await shoot("06_back_to_chinese_1600");

  // 窄一点的窗口：正文仍应跟随主区收窄，不产生横向滚动
  await viewport(1280, 900);
  const narrow = await evaluate(LAYOUT);
  record("1280 宽布局", narrow);
  const noOverflow = await evaluate("document.documentElement.scrollWidth <= innerWidth + 1");
  expect("1280 下正文贴合主区", narrow && narrow.leftGap <= 52 && narrow.rightGap <= 36, narrow && { leftGap: narrow.leftGap, rightGap: narrow.rightGap });
  expect("1280 下无横向溢出", noOverflow === true, { noOverflow, innerWidth: narrow?.innerWidth });
  await shoot("02_wide_1280");

  // 中文原文技能（无译本）：默认选中中文版、正文与目录都回落为原文，目录不能整块消失
  await goto(`http://127.0.0.1:${port}/my-skills`);
  const cnOpened = await openDetail("aihot");
  expect("打开中文原文技能 aihot", cnOpened === true, cnOpened);
  if (cnOpened) {
    await sleep(1400);
    const cn = await evaluate(LAYOUT);
    record("中文原文技能布局", cn);
    expect("中文原文技能：目录非空且与正文标题一致", cn?.tocCount > 0 && cn?.tocInBody === true,
      cn && { tocCount: cn.tocCount, tocSample: cn.tocSample, tocMissing: cn.tocMissing, bodyHeadingCount: cn.bodyHeadingCount });
    expect("中文原文技能：中文版仍默认选中（带缺译角标）", cn?.buttons?.find(b => b.label === "中文版")?.pressed === "true", cn?.buttons);
    expect("中文原文技能：中文版旁有缺译角标", cn?.buttons?.some(b => b.label === "中文版" && b.text.includes("缺少中文版")) === true, cn?.buttons?.map(b => b.text));
    expect("中文原文技能：不再出现整行提示", cn?.noticeRow === false, { noticeRow: cn?.noticeRow });
    await shoot("04_chinese_original_1280");
  }

  // 深色
  await invoke("set_settings", { key: "theme", value: "dark" });
  await evaluate(`localStorage.setItem('theme','dark')`);
  await goto(`http://127.0.0.1:${port}/my-skills`);
  const darkOpened = await openDetail("apple-design");
  expect("深色下重新打开详情", darkOpened === true, darkOpened);
  await sleep(1400);
  const dark = await evaluate(`(() => {
    const shell = document.querySelector('.skill-detail-shell');
    if (!shell) return { missing: true };
    const parse = v => (v.match(/[\\d.]+/g) ?? []).slice(0,3).map(Number);
    let node = shell, bg = null;
    while (node) { const c = getComputedStyle(node).backgroundColor; if (c && !/rgba?\\([^)]*,\\s*0(\\.\\d+)?\\)$/.test(c) && c !== 'transparent') { bg = c; break; } node = node.parentElement; }
    return { bg, luminance: bg ? Math.round(parse(bg).reduce((a, v, i) => a + v * [0.299, 0.587, 0.114][i], 0)) : null };
  })()`);
  record("深色背景", dark);
  expect("深色下详情面板为深色背景", dark?.luminance !== null && dark.luminance < 90, dark);
  await shoot("03_wide_dark");

  fs.writeFileSync(path.join(evidence, "report.json"), JSON.stringify({ tag, failures, results }, null, 2));
  console.log(`\n${results.length - failures.length}/${results.length} 通过`);
  if (failures.length) { console.error("失败项：", failures.map(f => f.name).join("、")); process.exitCode = 1; }
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  if (chrome) { try { chrome.kill(); } catch { /* ignore */ } }
  if (server) { try { server.kill(); } catch { /* ignore */ } }
}
