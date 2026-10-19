// 缺译本场景验收：默认选中「中文版」、正文不出现「暂无中文版」整行提示、
// 「中文版」按钮上有缺译角标、编辑入口仍可打开。
// 用隔离数据（复用 translation-coverage 的 seed：6 技能里 2 个英文缺译）。
// 用法：node output/detail-width/missing.mjs [tag]
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const tag = process.argv[2] ?? "missing";
const root = path.resolve("output/detail-width");
const runId = `run-${tag}-${Date.now()}`;
const dataRoot = path.join(root, "data", runId);
const home = path.join(dataRoot, "home");
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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "detail-missing-"));
const failures = [];
const results = [];
const record = (name, value) => { results.push({ name, value }); console.log(`· ${name}: ${JSON.stringify(value)}`); };
// 注意：detail 可能是 false / "" 这类假值，不能再用 `??` 兜底成 "ok"，否则会把失败当成功。
const expect = (name, condition, detail) => {
  if (condition) record(name, detail === undefined ? "ok" : detail);
  else { failures.push({ name, detail }); record(name, { FAILED: detail }); }
};

await new Promise((resolve, reject) => {
  const seeded = spawn(NODE, [path.resolve("output/translation-coverage/seed.mjs")], {
    stdio: "inherit", windowsHide: true, env: { ...process.env, TRANSLATION_COVERAGE_DATA: dataRoot },
  });
  seeded.on("exit", code => (code === 0 ? resolve() : reject(new Error(`seed 失败：${code}`))));
});

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
  const goto = async url => { await send("Page.navigate", { url }); await sleep(2700); };
  const shoot = async name => { const s = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(s.data, "base64")); };

  await send("Page.enable"); await send("Runtime.enable");
  await invoke("set_settings", { key: "theme", value: "light" });
  await goto(`http://127.0.0.1:${port}/`);
  await evaluate(`localStorage.setItem('theme','light'); localStorage.setItem('language','zh')`);
  await goto(`http://127.0.0.1:${port}/my-skills`);

  const openSkill = name => evaluate(`(async () => {
    const waitFor = async (t, n) => { for (let i = 0; i < n; i++) { const v = t(); if (v) return v; await new Promise(r => setTimeout(r, 200)); } return null; };
    const card = await waitFor(() => [...document.querySelectorAll('.app-panel')].find(el => el.textContent.includes(${JSON.stringify(name)}) && el.getBoundingClientRect().width > 0), 60);
    if (!card) return false;
    card.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 200)); card.click();
    return !!(await waitFor(() => document.querySelector('.skill-detail-shell'), 50));
  })()`, true);
  const opened = await openSkill("en-missing-alpha");
  expect("打开缺译本技能 en-missing-alpha", opened === true, opened);
  await sleep(1500);

  const STATE = `(() => {
    const shell = document.querySelector('.skill-detail-shell');
    if (!shell) return { missing: true };
    const main = shell.querySelector('.skill-detail-main');
    const row = shell.querySelector('nav[aria-label]')?.parentElement;
    const ctrl = row?.querySelector('[role="group"]')?.parentElement;
    const group = ctrl?.querySelector('[role="group"]');
    const zhBtn = group ? [...group.querySelectorAll('button')].find(b => b.textContent.includes('中文版')) : null;
    const tocNav = shell.querySelector('aside nav[aria-label]');
    const tocItems = tocNav ? [...tocNav.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean) : [];
    const bodyHeadings = main ? [...main.querySelectorAll('h1,h2,h3')].map(h => h.textContent.trim()).filter(Boolean) : [];
    const tocMissing = tocItems.filter(item => !bodyHeadings.some(h => h === item || h.includes(item) || item.includes(h)));
    const badges = zhBtn ? [...zhBtn.querySelectorAll('span')].filter(s => /缺少中文版/.test(s.textContent) || s.getAttribute('aria-hidden') === 'true') : [];
    return {
      zhPressed: zhBtn?.getAttribute('aria-pressed') ?? null,
      zhDisabled: zhBtn?.disabled ?? null,
      zhText: zhBtn?.textContent?.trim() ?? null,
      badgeCount: badges.length,
      badgeVisible: badges.some(s => s.getAttribute('aria-hidden') === 'true'),
      srText: badges.map(s => s.textContent.trim()).join('|'),
      noticeInBody: /暂无中文版/.test(main?.textContent ?? ''),
      bodyHasOriginal: (main?.textContent ?? '').includes('When to use'),
      editButtons: ctrl ? [...ctrl.querySelectorAll('button')].map(b => ({ text: b.textContent.trim(), disabled: b.disabled })) : [],
      // 正文顶部第一块是内容还是提示行
      firstBlockIsContent: !!main?.querySelector('article'),
      // 缺译本时目录必须与正文同源（都回落为原文），不能整块消失
      tocCount: tocItems.length,
      tocSample: tocItems.slice(0, 4),
      tocMissing: tocMissing.slice(0, 3),
      bodyHeadingSample: bodyHeadings.slice(0, 4),
      tocInBody: tocItems.length > 0 && tocMissing.length === 0,
    };
  })()`;
  const state = await evaluate(STATE);
  record("缺译本状态", state);
  expect("缺译本时默认选中「中文版」", state?.zhPressed === "true", state?.zhPressed);
  expect("「中文版」按钮可点（不再 disabled）", state?.zhDisabled === false, state?.zhDisabled);
  expect("正文不再出现「暂无中文版」整行提示", state?.noticeInBody === false, state?.noticeInBody);
  expect("缺译本时正文直接展示原文", state?.bodyHasOriginal === true, state?.bodyHasOriginal);
  // 这是本轮回归的核心：默认选中「中文版」但译文为空时，目录必须跟正文一起回落为原文，不能消失
  expect("缺译本时目录非空且与正文标题一致",
    state?.tocCount > 0 && state?.tocInBody === true,
    { tocCount: state?.tocCount, tocSample: state?.tocSample, tocMissing: state?.tocMissing, bodyHeadingSample: state?.bodyHeadingSample });
  // 缺译不再占用视觉：没有感叹号角标，说明只留在 sr-only 文本里给辅助技术
  expect("缺译本时界面上没有感叹号角标", state?.badgeVisible === false, { badgeVisible: state?.badgeVisible, spans: state?.srText });
  expect("缺译说明仍保留给辅助技术", /缺少中文版/.test(state?.srText ?? "") === true, state?.srText);
  expect("编辑入口仍可用（文案为添加中文版）", Array.isArray(state?.editButtons) && state.editButtons.some(b => b.text.includes("添加中文版") && b.disabled === false), state?.editButtons);
  await shoot("01_missing_badge");

  // 切到 English：目录同样跟随正文（原文），不能消失
  const switched = await evaluate(`(async () => {
    const row = document.querySelector('.skill-detail-shell nav[aria-label]')?.parentElement;
    const ctrl = row?.querySelector('[role="group"]')?.parentElement;
    const btn = ctrl ? [...ctrl.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('English')) : null;
    if (!btn) return false;
    btn.click();
    await new Promise(r => setTimeout(r, 900));
    return true;
  })()`, true);
  expect("切到 English", switched === true, switched);
  await sleep(900);
  const enState = await evaluate(STATE);
  record("English 状态", { tocCount: enState?.tocCount, tocSample: enState?.tocSample, tocMissing: enState?.tocMissing, bodyHeadingSample: enState?.bodyHeadingSample });
  expect("切到 English：目录非空且与正文标题一致", enState?.tocCount > 0 && enState?.tocInBody === true,
    { tocCount: enState?.tocCount, tocSample: enState?.tocSample, tocMissing: enState?.tocMissing });
  await shoot("02_missing_english");

  // 点编辑入口应能打开编辑器
  const editor = await evaluate(`(async () => {
    const row = document.querySelector('.skill-detail-shell nav[aria-label]')?.parentElement;
    const ctrl = row?.querySelector('[role="group"]')?.parentElement;
    const btn = ctrl ? [...ctrl.querySelectorAll('button')].find(b => /添加中文版/.test(b.textContent)) : null;
    if (!btn) return { missing: true };
    btn.click();
    await new Promise(r => setTimeout(r, 700));
    const ta = document.querySelector('.skill-detail-main textarea');
    return { open: !!ta, empty: ta ? ta.value === '' : null };
  })()`, true);
  record("编辑器", editor);
  expect("缺译本时点编辑入口能打开空编辑器", editor?.open === true, editor);

  // 中文原文技能：文档本来就是中文，不需要「中文版」，界面上不该有任何缺译表达
  await goto(`http://127.0.0.1:${port}/my-skills`);
  const zhOpened = await openSkill("zh-native");
  expect("打开中文原文技能 zh-native", zhOpened === true, zhOpened);
  if (zhOpened) {
    await sleep(1400);
    const zh = await evaluate(STATE);
    record("中文原文技能状态", { zhText: zh?.zhText, badgeVisible: zh?.badgeVisible, srText: zh?.srText, tocCount: zh?.tocCount, tocSample: zh?.tocSample, editButtons: zh?.editButtons });
    expect("中文原文技能：无角标、无缺译说明", zh?.badgeVisible === false && !/缺少中文版/.test(zh?.srText ?? ""),
      { badgeVisible: zh?.badgeVisible, srText: zh?.srText, zhText: zh?.zhText });
    expect("中文原文技能：目录仍与正文同源", zh?.tocCount > 0 && zh?.tocInBody === true,
      { tocCount: zh?.tocCount, tocSample: zh?.tocSample, tocMissing: zh?.tocMissing });
    await shoot("03_chinese_original");
  }
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  if (chrome) { try { chrome.kill(); } catch { /* ignore */ } }
  if (server) { try { server.kill(); } catch { /* ignore */ } }
}

fs.writeFileSync(path.join(evidence, "report.json"), JSON.stringify({ tag, failures, results }, null, 2));
console.log(`\n${results.length - failures.length}/${results.length} 通过`);
if (failures.length) { console.error("失败项：", failures.map(f => f.name).join("、")); process.exitCode = 1; }
