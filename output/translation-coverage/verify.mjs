// 「中文译本」统计卡验收：隔离数据 + 真实后端 + 无头 Chrome。
// 覆盖：分母只算英文原文、缺译/待复核分开、名单展开与点击进详情、保存译文后数字变化、
//       英文界面文案、深色与 960 窄窗口、页面无横向溢出。
// 用法：node output/translation-coverage/verify.mjs [tag]
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const tag = process.argv[2] ?? "run";
const root = path.resolve("output/translation-coverage");
const runId = `run-${tag}-${Date.now()}`;
const dataRoot = path.join(root, "data", runId);
const home = path.join(dataRoot, "home");
const evidence = path.join(root, "evidence", tag);
fs.mkdirSync(evidence, { recursive: true });

const NODE = process.execPath;
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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "translation-coverage-profile-"));

const failures = [];
const results = [];
const record = (name, value) => { results.push({ name, value }); console.log(`· ${name}: ${JSON.stringify(value)}`); };
const expect = (name, condition, detail) => {
  if (condition) record(name, detail ?? "ok");
  else { failures.push({ name, detail }); record(name, { FAILED: detail }); }
};

await new Promise((resolve, reject) => {
  const seeded = spawn(NODE, [path.join(root, "seed.mjs")], {
    stdio: "inherit", windowsHide: true,
    env: { ...process.env, TRANSLATION_COVERAGE_DATA: dataRoot },
  });
  seeded.on("exit", code => (code === 0 ? resolve() : reject(new Error(`seed 失败：exit ${code}`))));
});

const server = spawn(NODE, ["backend/server.mjs", "--port", String(port), "--directory", path.join(home, ".skills-manager"), "--home", home],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
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
try {
  const deadline = Date.now() + 20000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* 未就绪 */ }
    if (Date.now() > deadline) throw new Error(`本地服务未就绪：${serverLog}`);
    await sleep(150);
  }

  // ── 1. 后端口径：分母只含英文原文 ──
  const coverage = await invoke("get_translation_coverage");
  record("后端口径", coverage);
  expect("英文原文 4 个（中文原文不计入）", coverage.english === 4 && coverage.chinese === 2, { english: coverage.english, chinese: coverage.chinese });
  expect("缺译 2 个", coverage.missing === 2, coverage.missing);
  expect("待复核 1 个", coverage.stale === 1, coverage.stale);
  expect("已译 1 个", coverage.translated === 1, coverage.translated);
  expect("缺译名单条数一致", coverage.missing_skills.length === 2, coverage.missing_skills.map(item => item.name));
  expect("名单不含中文原文技能", !coverage.missing_skills.some(item => item.name.startsWith("zh-native")), coverage.missing_skills.map(item => item.name));

  // ── 2. 无头 Chrome ──
  let target = null;
  let chromeLog = "";
  for (let attempt = 0; attempt < 2 && !target; attempt++) {
    if (chrome) { try { chrome.kill(); } catch { /* ignore */ } }
    const attemptPort = attempt === 0 ? debugPort : await freePort();
    chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
      `--remote-debugging-port=${attemptPort}`, "--remote-allow-origins=*", `--user-data-dir=${profile}`,
      "--window-size=1536,1024", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
    chrome.stdout.on("data", chunk => { chromeLog += chunk; });
    chrome.stderr.on("data", chunk => { chromeLog += chunk; });
    for (let index = 0; index < 60 && !target; index++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${attemptPort}/json/list`)).json();
        target = list.find(item => item.type === "page" && item.webSocketDebuggerUrl);
      } catch { /* 等端口 */ }
      if (!target) await sleep(250);
    }
    if (!target) await sleep(500);
  }
  if (!target) throw new Error(`找不到可调试的页面目标：${chromeLog.slice(0, 400)}`);

  ws = new WebSocket(target.webSocketDebuggerUrl);
  if (ws.readyState !== 1) await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
  let seq = 0;
  const pendingMessages = new Map();
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    const entry = pendingMessages.get(message.id);
    if (entry) {
      pendingMessages.delete(message.id);
      message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
    }
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq; pendingMessages.set(id, { resolve, reject });
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
    await sleep(600);
  };
  const key = async keyName => {
    const code = keyName === "Escape" ? 27 : 0;
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: keyName, code: keyName, windowsVirtualKeyCode: code });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: keyName, code: keyName, windowsVirtualKeyCode: code });
    await sleep(350);
  };
  const clickAt = async (x, y) => {
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    await sleep(400);
  };

  // 定位只依赖结构：本卡是唯一带 role=progressbar 的统计卡，展开按钮是卡内唯一带 aria-controls 的按钮。
  const CARD = `[...document.querySelectorAll('section.app-panel')].find(s => s.querySelector('[role="progressbar"]'))`;
  const TRIGGER = `${CARD}?.querySelector('button[aria-controls]')`;
  const PANEL = `document.getElementById(${TRIGGER}?.getAttribute('aria-controls'))`;

  await send("Page.enable");
  await send("Runtime.enable");
  await goto(`http://127.0.0.1:${port}/`);
  await evaluate(`localStorage.setItem('theme','light'); localStorage.setItem('language','zh')`);
  await goto(`http://127.0.0.1:${port}/`);

  // ── 3. 卡片：4 张统计卡，第 4 张是中文译本 ──
  const cards = await evaluate(`(() => [...document.querySelectorAll('section.app-panel')].slice(0,4).map(s => ({
    title: s.querySelector('.app-section-title')?.textContent.trim() ?? null,
    hasBar: !!s.querySelector('[role="progressbar"]'),
  })))()`);
  record("四张统计卡", cards);
  expect("第 4 张是中文译本且带进度条", cards.length === 4 && cards[3].title === "中文译本" && cards[3].hasBar === true, cards);
  expect("前三张顺序不变", cards[0].title === "技能总量" && cards[1].title === "部署覆盖" && cards[2].title === "已启用 Agent", cards.map(c => c.title));

  const cardState = await evaluate(`(() => {
    const card = ${CARD};
    const bar = card.querySelector('[role="progressbar"]');
    return {
      text: card.textContent.replace(/\\s+/g,' ').trim(),
      value: bar.getAttribute('aria-valuenow'),
      width: card.querySelector('[role="progressbar"] > div').style.width,
      trigger: ${TRIGGER}?.textContent.trim() ?? null,
      expanded: ${TRIGGER}?.getAttribute('aria-expanded') ?? null,
      panel: !!${PANEL},
    };
  })()`);
  record("卡片收起态", cardState);
  expect("大字是缺译数 2（不是英文技能数 4）", /^中文译本2个待译/.test(cardState.text.replace(/\s/g, "")), cardState.text);
  expect("进度 = 已译 1 / 英文 4 = 25%", cardState.value === "25" && cardState.width === "25%", { value: cardState.value, width: cardState.width });
  expect("缺译时可展开名单", cardState.trigger?.includes("2 个待译") && cardState.expanded === "false" && !cardState.panel, cardState);
  expect("提示原文改动待复核", cardState.text.includes("1 个译文对应旧原文"), cardState.text);
  await shoot("01_collapsed_light");

  // ── 4. 展开名单：就是那两个缺译技能 ──
  await evaluate(`${TRIGGER}.click()`);
  await sleep(400);
  const panel = await evaluate(`(() => {
    const panel = ${PANEL};
    if (!panel) return null;
    const card = ${CARD};
    const trigger = ${TRIGGER};
    const rect = panel.getBoundingClientRect();
    return {
      rows: [...panel.querySelectorAll('li button')].map(button => button.textContent.trim()),
      title: panel.querySelector('p')?.textContent.trim(),
      hint: panel.lastElementChild?.textContent.trim(),
      top: Math.round(rect.top), left: Math.round(rect.left), right: Math.round(rect.right),
      triggerBottom: Math.round(trigger.getBoundingClientRect().bottom),
      insideViewport: rect.top >= 0 && rect.right <= innerWidth && rect.left >= 0,
      overflow: getComputedStyle(card).overflow,
      expanded: trigger.getAttribute('aria-expanded'),
    };
  })()`);
  record("展开后的名单", panel);
  expect("名单条数 = 缺译数", panel?.rows.length === 2, panel?.rows);
  expect("名单展示别名而非原名", panel?.rows.some(row => row.includes("待译样例")) && !panel.rows.some(row => row.includes("en-missing-alpha")), panel?.rows);
  expect("长名技能也在名单里", panel?.rows.some(row => row.includes("en-missing-beta-with-long-name")), panel?.rows);
  expect("名单标题与提示", panel?.title === "待译技能" && panel?.hint === "点击技能名打开详情，粘贴中文版即可", { title: panel?.title, hint: panel?.hint });
  expect("中文原文技能不在名单里", !panel?.rows.some(row => row.includes("zh-native")), panel?.rows);
  expect("面板贴在触发按钮下方且未被裁切", panel && panel.top >= panel.triggerBottom && panel.overflow === "visible", panel && { top: panel.top, triggerBottom: panel.triggerBottom, overflow: panel.overflow });
  expect("面板完整在视口内", panel?.insideViewport === true, panel);
  await shoot("02_expanded_light");

  // ── 5. Escape / 外点收起 ──
  await key("Escape");
  expect("Escape 收起面板", await evaluate(`!${PANEL} && ${TRIGGER}.getAttribute('aria-expanded') === 'false'`));
  await evaluate(`${TRIGGER}.click()`);
  await sleep(300);
  await clickAt(20, 20);
  expect("点击面板外收起", await evaluate(`!${PANEL}`));

  // ── 6. 行点击打开详情，且面板收起 ──
  await evaluate(`${TRIGGER}.click()`);
  await sleep(300);
  await evaluate(`[...${PANEL}.querySelectorAll('li button')].find(b => b.textContent.includes('待译样例')).click()`);
  await sleep(900);
  const opened = await evaluate(`(() => {
    const shell = document.querySelector('.skill-detail-shell');
    const zhTab = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '中文版');
    return {
      open: !!shell, label: shell?.getAttribute('aria-label') ?? null,
      panelClosed: !${PANEL}, zhDisabled: zhTab ? zhTab.disabled : null,
    };
  })()`);
  record("行点击后的详情", opened);
  expect("点击名单行打开对应技能详情", opened.open && opened.label === "待译样例", opened);
  expect("打开详情时面板已收起", opened.panelClosed === true, opened.panelClosed);
  expect("缺译技能的中文版入口不可用", opened.zhDisabled === true, opened.zhDisabled);
  await shoot("03_detail_missing_translation");
  await key("Escape");
  await sleep(400);

  // ── 7. 补一个译本后数字跟着变（25% → 50%，缺译 2 → 1） ──
  const target2 = await invoke("get_managed_skills");
  const missingSkill = target2.find(skill => skill.name === "en-missing-alpha");
  const current = await invoke("get_skill_translation", { skillId: missingSkill.id });
  await invoke("set_skill_translation", {
    skillId: missingSkill.id,
    content: "# en-missing-alpha\n\n## 何时使用\n\n补上的中文版。\n",
    sourceHash: current.source_hash,
    expectedRevision: current.revision,
  });
  await goto(`http://127.0.0.1:${port}/`);
  const afterSave = await evaluate(`(() => {
    const card = ${CARD};
    return { text: card.textContent.replace(/\\s+/g,' ').trim(), value: card.querySelector('[role="progressbar"]').getAttribute('aria-valuenow') };
  })()`);
  record("补译后的卡片", afterSave);
  expect("补译后缺译 1、进度 50%", /1个待译/.test(afterSave.text.replace(/\s/g, "")) && afterSave.value === "50", afterSave);
  expect("补译后名单只剩 1 个", afterSave.text.includes("1 个待译"), afterSave.text);

  // ── 8. 英文界面 ──
  await evaluate(`localStorage.setItem('language','en')`);
  await goto(`http://127.0.0.1:${port}/`);
  const english = await evaluate(`(() => {
    const card = ${CARD};
    return { title: card.querySelector('.app-section-title')?.textContent.trim(), text: card.textContent.replace(/\\s+/g,' ').trim(), trigger: ${TRIGGER}?.textContent.trim() ?? null };
  })()`);
  record("英文界面", english);
  expect("英文界面文案齐全", english.title === "Chinese version" && english.text.includes("to translate") && english.trigger?.includes("to translate"), english);
  await shoot("04_english_light");

  // ── 9. 深色 + 960 窄窗口 ──
  await evaluate(`localStorage.setItem('theme','dark'); localStorage.setItem('language','zh')`);
  await goto(`http://127.0.0.1:${port}/`);
  const dark = await evaluate(`(() => ({ bg: getComputedStyle(document.body).backgroundColor, text: getComputedStyle(${CARD}.querySelector('h3')).color }))()`);
  record("深色", dark);
  expect("深色下背景与数字颜色反转", dark.bg !== "rgb(255, 255, 255)" && dark.text !== "rgb(23, 23, 23)", dark);
  await shoot("05_collapsed_dark");

  await viewport(960, 900);
  const narrow = await evaluate(`(() => {
    const card = ${CARD};
    const rect = card.getBoundingClientRect();
    return {
      cols: getComputedStyle(card.parentElement).gridTemplateColumns.split(' ').length,
      cardWidth: Math.round(rect.width), right: Math.round(rect.right),
      scrollWidth: document.documentElement.scrollWidth, innerWidth,
      cards: document.querySelectorAll('section.app-panel').length,
    };
  })()`);
  record("960 窄窗口", narrow);
  expect("960 下两列排布且无横向溢出", narrow.cols === 2 && narrow.scrollWidth <= narrow.innerWidth, narrow);
  await shoot("06_narrow_dark");
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  if (chrome) { try { chrome.kill(); } catch { /* ignore */ } }
  if (server) { try { server.kill(); } catch { /* ignore */ } }
}

fs.writeFileSync(path.join(evidence, "report.json"), JSON.stringify({ tag, runId, failures, results }, null, 2));
console.log(`\n${results.length - failures.length}/${results.length} 通过`);
if (failures.length) {
  console.error("失败项：", failures.map(item => item.name).join("、"));
  process.exitCode = 1;
}
