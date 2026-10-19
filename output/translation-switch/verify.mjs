// 「语言切换移到页签行 + 切换不动滚动位置」验收：隔离数据 + 真实后端 + 无头 Chrome。
// 覆盖：控件在页签行最右侧且与页签同高、正文区不再有切换/编辑按钮、切换后 scrollTop 不变、
//       切到调用记录后按钮禁用、编辑器仍从正文顶部展开、窄屏与深色下不溢出。
// 用法：node output/translation-switch/verify.mjs [tag]
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const tag = process.argv[2] ?? "run";
const root = path.resolve("output/translation-switch");
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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "translation-switch-profile-"));

const failures = [];
const results = [];
const record = (name, value) => { results.push({ name, value }); console.log(`· ${name}: ${JSON.stringify(value)}`); };
const expect = (name, condition, detail) => {
  if (condition) record(name, detail ?? "ok");
  else { failures.push({ name, detail }); record(name, { FAILED: detail }); }
};

await new Promise((resolve, reject) => {
  const seeded = spawn(NODE, [path.resolve("output/translation-coverage/seed.mjs")], {
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

  // ── 手写一份够长的译文，保证正文能滚出多屏（滚动位置断言才有意义） ──
  const skills = await invoke("get_managed_skills");
  const done = skills.find(skill => skill.name === "en-done");
  // 两侧都要能滚出好几屏，否则「切换语言保持滚动位置」无从验证：
  // 若英文原文比可视区还短，scrollTop 会被浏览器合法夹到 0，看上去像被重置。
  const sectionCount = 14;
  const zhSections = Array.from({ length: sectionCount }, (_, index) => [
    `## 第 ${index + 1} 节`,
    "",
    `这是第 ${index + 1} 节的中文正文，用来说明审阅者在什么情况下需要这一段，以及需要检查哪些内容。`,
    `为了撑出与英文原文相近的高度，这里补足同样的行数与段落数量。第 ${index + 1} 节的要点如下：`,
    "",
    "- 要点一：先确认输入文件存在且可读",
    "- 要点二：再确认输出与预期一致",
    "",
  ].join("\n")).join("\n");
  const enSections = Array.from({ length: sectionCount }, (_, index) => [
    `## Section ${index + 1}`,
    "",
    `This is the English body of section ${index + 1}. It explains when a reviewer needs this part and what has to be checked.`,
    `The paragraph is padded so both versions are close in height, which keeps the scroll position meaningful. Section ${index + 1} covers:`,
    "",
    "- First point: make sure the input file exists and is readable",
    "- Second point: then confirm the output matches the expectation",
    "",
  ].join("\n")).join("\n");

  // 把英文原文写成完整长文，并同步译文（两边标题结构一一对应）。
  const central = path.join(home, ".skills-manager", "skills", done.name, "SKILL.md");
  fs.writeFileSync(central, [
    "---",
    `name: ${done.name}`,
    "description: English skill used by the translation fixture; the body is padded so both languages scroll.",
    "---",
    "",
    `# ${done.name}`,
    "",
    "## When to use",
    "",
    "Use this skill when the reviewer needs a deterministic checklist and wants to compare both language versions.",
    "",
    enSections,
  ].join("\n"));

  const current = await invoke("get_skill_translation", { skillId: done.id });
  await invoke("set_skill_translation", {
    skillId: done.id,
    content: `# ${done.name}\n\n## 何时使用\n\n当审阅者需要一份确定性的检查清单、并想对照两种语言版本时使用。\n\n${zhSections}`,
    sourceHash: current.source_hash,
    expectedRevision: current.revision,
  });

  // ── 无头 Chrome ──
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
    await sleep(300);
  };

  await send("Page.enable");
  await send("Runtime.enable");
  // 主题以 store 里的设置为准（useTheme 挂载时会用 get_settings 覆盖 localStorage），两者都要写。
  await invoke("set_settings", { key: "theme", value: "light" });
  await goto(`http://127.0.0.1:${port}/`);
  await evaluate(`localStorage.setItem('theme','light'); localStorage.setItem('language','zh')`);
  await goto(`http://127.0.0.1:${port}/`);
  expect("浅色主题生效", await evaluate(`!document.documentElement.classList.contains('dark')`));

  // 打开 en-done 的详情：等技能库列表渲染出卡片再点（列表/网格视图都是 .app-panel + onClick）
  const openDetail = `(async () => {
    const waitFor = async (test, tries) => { for (let i = 0; i < tries; i++) { const value = test(); if (value) return value; await new Promise(r => setTimeout(r, 200)); } return null; };
    const shell = () => document.querySelector('.skill-detail-shell');
    if (shell()) return true;
    const card = await waitFor(() => [...document.querySelectorAll('.app-panel')]
      .find(el => el.textContent.includes('en-done') && el.getBoundingClientRect().width > 0), 60);
    if (!card) return { ok: false, reason: 'card-not-found', panels: document.querySelectorAll('.app-panel').length, panelsText: [...document.querySelectorAll('.app-panel')].slice(0, 6).map(el => el.textContent.trim().slice(0, 30)) };
    card.scrollIntoView({ block: 'center' });
    await new Promise(r => setTimeout(r, 200));
    card.click();
    const found = await waitFor(shell, 50);
    return found ? true : { ok: false, reason: 'dialog-not-opened' };
  })()`;

  await goto(`http://127.0.0.1:${port}/my-skills`);
  const opened = await evaluate(openDetail, true);
  expect("打开 en-done 详情", opened === true, opened);
  await sleep(1400);

  const SHELL = `document.querySelector('.skill-detail-shell')`;
  const MAIN = `${SHELL}.querySelector('.skill-detail-main')`;
  const NAV = `${SHELL}.querySelector('nav[aria-label]')`;
  const CTRL = `${NAV}?.parentElement?.querySelector('[role="group"]')?.parentElement`;

  // ── 1. 控件在页签行最右侧、与页签同一行 ──
  const layout = await evaluate(`(() => {
    const shell = ${SHELL}, nav = ${NAV}, ctrl = ${CTRL};
    if (!shell || !nav || !ctrl) return { missing: true, shell: !!shell, nav: !!nav, ctrl: !!ctrl };
    const rect = node => { const r = node.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) }; };
    const tabs = [...nav.querySelectorAll('button')].map(b => ({ text: b.textContent.trim(), ...rect(b) }));
    const group = ctrl.querySelector('[role="group"]');
    const buttons = [...ctrl.querySelectorAll('button')].map(b => ({ text: b.textContent.trim(), pressed: b.getAttribute('aria-pressed'), disabled: b.disabled, ...rect(b) }));
    return {
      ctrl: rect(ctrl), nav: rect(nav), tabs, buttons,
      sameRow: Math.abs(rect(nav).y - rect(ctrl).y) < 12,
      ctrlRightOfTabs: rect(ctrl).x >= Math.max(...tabs.map(t => t.right)) - 4,
      navRight: rect(nav).right, ctrlRight: rect(ctrl).right,
    };
  })()`);
  record("页签行布局", layout);
  expect("详情面板可定位（shell / nav / 控件齐全）", layout?.missing !== true, layout);
  expect("页签行（nav）与控件（ctrl）在同一行", layout?.sameRow === true, layout && { nav: layout.nav, ctrl: layout.ctrl });
  expect("控件在页签右侧、贴靠行尾", layout?.ctrlRightOfTabs === true && layout.ctrlRight >= layout.navRight - 1, layout && { ctrl: layout.ctrl, nav: layout.nav });
  expect("行内含「中文版 / 英文原文」", layout?.buttons?.some(b => b.text === "中文版") && layout.buttons.some(b => b.text === "英文原文"), layout?.buttons?.map(b => b.text));
  expect("行内含「更新中文版」编辑入口", layout?.buttons?.some(b => b.text.includes("更新中文版")), layout?.buttons?.map(b => b.text));
  await shoot("01_nav_right_light");

  // ── 2. 正文区不再有语言切换与编辑按钮 ──
  const insideMain = await evaluate(`(() => {
    const main = ${MAIN};
    if (!main) return { missing: true };
    return {
      pressed: main.querySelectorAll('[aria-pressed]').length,
      editButton: [...main.querySelectorAll('button')].filter(b => /中文版/.test(b.textContent)).length,
      firstChild: main.firstElementChild?.className ?? null,
    };
  })()`);
  record("正文区", insideMain);
  expect("正文区没有语言切换按钮", insideMain?.pressed === 0, insideMain?.pressed);
  expect("正文区没有编辑/添加中文版按钮", insideMain?.editButton === 0, insideMain?.editButton);

  // ── 3. 切换语言不动滚动位置 ──
  const scrollBefore = await evaluate(`(() => { const main = ${MAIN}; if (!main) return null; main.scrollTop = 900; return main.scrollTop; })()`);
  await sleep(400);
  const switched = await evaluate(`(async () => {
    const main = ${MAIN}; const ctrl = ${CTRL};
    if (!main || !ctrl) return { missing: true };
    const btn = [...ctrl.querySelectorAll('button')].find(b => b.textContent.trim() === '英文原文');
    if (!btn) return { missing: true, reason: 'no-en-button' };
    const before = main.scrollTop;
    const headingBefore = main.querySelector('h3, h2')?.textContent ?? null;
    btn.click();
    await new Promise(r => setTimeout(r, 700));
    const afterEnglish = main.scrollTop;
    const englishText = main.textContent.includes('When to use');
    const zh = [...ctrl.querySelectorAll('button')].find(b => b.textContent.trim() === '中文版');
    zh.click();
    await new Promise(r => setTimeout(r, 700));
    const afterChinese = main.scrollTop;
    const chineseText = main.textContent.includes('何时使用');
    return { before, afterEnglish, afterChinese, englishText, chineseText, headingBefore, headingAfter: main.querySelector('h3, h2')?.textContent ?? null,
      englishPressed: btn.getAttribute('aria-pressed'), zhPressed: zh.getAttribute('aria-pressed') };
  })()`, true);
  record("切换语言", switched);
  expect("切到英文原文时正文真的换了", switched?.englishText === true, switched?.englishText);
  expect("切回中文版时正文真的换了", switched?.chineseText === true, switched?.chineseText);
  expect("切到英文原文不改变滚动位置", switched && Math.abs(switched.afterEnglish - switched.before) <= 2, switched && { before: switched.before, after: switched.afterEnglish });
  expect("切回中文版不改变滚动位置", switched && Math.abs(switched.afterChinese - switched.before) <= 2, switched && { before: switched.before, after: switched.afterChinese });
  expect("滚动位置确实不在顶部（断言有效）", scrollBefore >= 900, scrollBefore);
  expect("切换后按钮选中态正确", switched?.englishPressed === "false" && switched?.zhPressed === "true", switched && { en: switched.englishPressed, zh: switched.zhPressed });
  await shoot("02_switch_keeps_scroll_light");

  // ── 4. 编辑器：从行尾按钮打开，编辑器出现在正文顶部 ──
  await evaluate(`(() => { const main = ${MAIN}; if (main) main.scrollTop = 0; })()`);
  await sleep(300);
  const editor = await evaluate(`(async () => {
    const ctrl = ${CTRL}, main = ${MAIN};
    if (!ctrl || !main) return { missing: true };
    [...ctrl.querySelectorAll('button')].find(b => /更新中文版/.test(b.textContent)).click();
    await new Promise(r => setTimeout(r, 600));
    const textarea = main.querySelector('textarea');
    return { open: !!textarea, value: textarea?.value?.slice(0, 20) ?? null, scrollTop: main.scrollTop };
  })()`, true);
  record("编辑器", editor);
  expect("行尾按钮能打开编辑器", editor?.open === true, editor);
  expect("编辑器内容取当前译文", (editor?.value ?? "").startsWith("# en-done"), editor?.value);
  await shoot("03_editor_open_light");
  await evaluate(`(() => { const main = ${MAIN}; main?.querySelector('textarea') && [...main.querySelectorAll('button')].find(b => b.textContent.trim() === '取消编辑')?.click(); })()`);
  await sleep(400);
  expect("取消后编辑器关闭", await evaluate(`(() => { const main = ${MAIN}; return !main || !main.querySelector('textarea'); })()`));

  // ── 5. 切到调用记录页签时行尾按钮禁用 ──
  const disabledOnOtherTab = await evaluate(`(async () => {
    const nav = ${NAV};
    if (!nav) return { missing: true };
    const tab = [...nav.querySelectorAll('button')].find(b => b.textContent.trim() === '调用记录');
    if (!tab) return { missing: true, reason: 'no-activity-tab' };
    tab.click();
    await new Promise(r => setTimeout(r, 700));
    const ctrl = ${CTRL};
    const buttons = ctrl ? [...ctrl.querySelectorAll('button')].map(b => ({ text: b.textContent.trim(), disabled: b.disabled })) : [];
    const doc = [...nav.querySelectorAll('button')].find(b => b.textContent.trim() === '文档');
    doc?.click();
    await new Promise(r => setTimeout(r, 700));
    return buttons;
  })()`, true);
  record("调用记录页签时的控件", disabledOnOtherTab);
  expect("非文档页签时编辑入口与重读按钮禁用", Array.isArray(disabledOnOtherTab) && disabledOnOtherTab.length > 0 && disabledOnOtherTab.filter(b => !b.text.includes("中文版") && !b.text.includes("英文原文")).every(b => b.disabled === true), disabledOnOtherTab);

  // ── 6. 深色 + 窄屏 ──
  await invoke("set_settings", { key: "theme", value: "dark" });
  await evaluate(`localStorage.setItem('theme','dark')`);
  await goto(`http://127.0.0.1:${port}/my-skills`);
  expect("深色主题生效", await evaluate(`document.documentElement.classList.contains('dark')`));
  const reopened = await evaluate(openDetail, true);
  expect("深色下重新打开 en-done 详情", reopened === true, reopened);
  await sleep(1400);
  // 深色不是只看 <html class="dark">：量一下正文背景亮度，避免「类名加上但样式没生效」。
  const darkBackground = await evaluate(`(() => {
    const main = ${MAIN};
    if (!main) return { missing: true };
    const parse = value => (value.match(/[\\d.]+/g) ?? []).slice(0, 3).map(Number);
    // 正文区本身是透明底，底色来自祖先：往上找第一个不透明背景再量。
    let node = main, applied = null;
    while (node && node !== document.documentElement) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && !/rgba?\\([^)]*,\\s*0(\\.\\d+)?\\)$/.test(bg) && bg !== 'transparent') { applied = { selector: node.className?.toString().slice(0, 40) || node.tagName, bg }; break; }
      node = node.parentElement;
    }
    const luminance = ([r, g, b]) => (r * 0.299 + g * 0.587 + b * 0.114);
    const text = getComputedStyle(main).color;
    return { applied, text, bgLuminance: applied ? Math.round(luminance(parse(applied.bg))) : null, textLuminance: Math.round(luminance(parse(text))) };
  })()`);
  record("深色正文配色", darkBackground);
  expect("深色下正文背景是深色、文字是浅色", darkBackground?.bgLuminance !== null && darkBackground.bgLuminance < 90 && darkBackground.textLuminance > 140, darkBackground);
  await shoot("04_nav_right_dark");

  await viewport(900, 900);
  const narrow = await evaluate(`(() => {
    const ctrl = ${CTRL}, nav = ${NAV};
    if (!ctrl || !nav) return { missing: true };
    const r = ctrl.getBoundingClientRect();
    return { visible: r.width > 0, right: Math.round(r.right), innerWidth, navBottom: Math.round(nav.getBoundingClientRect().bottom), ctrlBottom: Math.round(r.bottom), scrollWidth: document.documentElement.scrollWidth };
  })()`);
  record("900 窄窗口", narrow);
  expect("窄屏控件仍可见且不溢出", narrow?.visible === true && narrow.scrollWidth <= narrow.innerWidth + 1, narrow);
  await shoot("05_nav_right_narrow");
  await key("Escape");
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
