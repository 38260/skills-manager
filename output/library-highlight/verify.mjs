// 技能库搜索结果高亮验收：隔离库 + 真实后端 + 无头 Chrome。
// 用法：node output/library-highlight/verify.mjs [tag]
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const tag = process.argv[2] ?? "run";
const root = path.resolve("output/library-highlight");
const dataRoot = path.join(root, "data", `run-${tag}-${Date.now()}`);
const home = path.join(dataRoot, "home");
const evidence = path.join(root, "evidence", tag);
fs.mkdirSync(evidence, { recursive: true });

const NODE = process.execPath;
const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
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
const expect = (name, ok, detail) => {
  if (ok) record(name, detail ?? "ok");
  else { failures.push({ name, detail }); record(name, { FAILED: detail }); }
};

// 复用列宽验收那份数据：12 个技能（gamma-a11y / Accessibility checks… 等着陆点）。
await new Promise((resolve, reject) => {
  const seeded = spawn(NODE, [path.resolve("output/column-widths/seed.mjs")], {
    stdio: "ignore", windowsHide: true, env: { ...process.env, COLWIDTH_DATA: dataRoot },
  });
  seeded.on("exit", code => (code === 0 ? resolve() : reject(new Error(`seed 失败：${code}`))));
});

// 补描述与别名：installLocal 不写 description，没描述就验不了描述高亮。
await new Promise((resolve, reject) => {
  const extra = spawn(NODE, [path.resolve("output/library-highlight/seed-extra.mjs")], {
    stdio: "ignore", windowsHide: true, env: { ...process.env, LIBHL_DATA: dataRoot },
  });
  extra.on("exit", code => (code === 0 ? resolve() : reject(new Error(`补充技能资料失败：${code}`))));
});

const port = await freePort();
const debugPort = await freePort();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "library-highlight-"));
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
    if (entry) { pending.delete(message.id); entry.resolve(message.result); }
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params ?? {} }));
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true });
    if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result?.result?.value;
  };
  const goto = async url => { await send("Page.navigate", { url }); await sleep(2600); };
  const shoot = async name => {
    const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1600, height: 950, scale: 1 } });
    if (shot?.data) fs.writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(shot.data, "base64"));
    else console.error(["截图为空", name]);
  };
  const viewport = async (width, height) => {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await sleep(600);
  };
  const typeInSearch = async text => {
    await evaluate(`(() => { const input = [...document.querySelectorAll('input')].find(el => /搜索/.test(el.placeholder || '')); if (!input) return false; input.focus(); input.value=''; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await sleep(400);
    for (const char of text) {
      await send("Input.dispatchKeyEvent", { type: "char", text: char });
      await sleep(70);
    }
    await sleep(900);
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await viewport(1600, 950);
  await goto(`http://127.0.0.1:${port}/`);
  await evaluate(`localStorage.setItem('theme','light'); localStorage.setItem('language','zh')`);
  await goto(`http://127.0.0.1:${port}/my-skills`);
  // 空库引导弹窗：点「全新开始」关掉
  await evaluate(`(() => { const btn = [...document.querySelectorAll('button')].find(b => /全新开始/.test(b.textContent)); btn?.click(); return !!btn; })()`);
  await sleep(1000);

  const READ = `(() => {
    const marks = [...document.querySelectorAll('mark')];
    const cards = [...document.querySelectorAll('h3')].filter(el => el.textContent.trim());
    const chips = [...document.querySelectorAll('p span')].filter(el => /命中/.test(el.textContent || ''));
    const descriptions = [...document.querySelectorAll('p')]
      .filter(el => el.querySelector('mark') || el.querySelector('span'))
      .map(el => el.textContent.trim());
    return {
      cards: cards.length,
      markCount: marks.length,
      markTexts: marks.map(el => el.textContent),
      firstCard: cards[0] ? cards[0].textContent.trim() : null,
      descriptionMarks: [...document.querySelectorAll('p mark')].map(el => el.textContent),
      nameMarks: [...document.querySelectorAll('h3 mark')].map(el => el.textContent),
      chipTexts: chips.map(el => el.textContent.trim()),
      chipTitles: chips.map(el => el.getAttribute('title')),
      descriptionTexts: descriptions,
    };
  })()`;

  // ── 1. 无关键词时不应有任何高亮 ──
  const before = await evaluate(READ);
  record("初始（无搜索）", before);
  expect("未搜索时没有高亮", before.markCount === 0, before.markCount);

  // ── 2. 命中技能名 ──
  await typeInSearch("gamma");
  const byName = await evaluate(READ);
  record("搜索 gamma", byName);
  expect("只剩 1 个技能", byName.cards === 1, byName.cards);
  expect("技能名里的 gamma 被高亮", byName.nameMarks.includes("gamma"), byName.nameMarks);
  await shoot("01_grid_name");

  // ── 3. 命中描述（且把长描述里深处的高亮前置）──
  await typeInSearch("清单");
  const byDescription = await evaluate(READ);
  record("搜索 清单（描述）", byDescription);
  expect("描述里的 清单 被高亮", byDescription.descriptionMarks.includes("清单"), byDescription.descriptionMarks);
  // 长描述（100+ 字）里命中在第 80 字左右：现在显示的是命中处前后的片段，不再是整段开头。
  const shown = (await evaluate(`(() => { const p = [...document.querySelectorAll('p')].find(el => el.querySelector('mark')); return p ? p.textContent.trim() : null; })()`)) ?? "";
  record("描述展示文本", shown.slice(0, 120));
  // 片段以省略号开头（说明不是从整段开头显示），且高亮词就在里面。
  expect("长描述被截成命中处前后的片段", shown.replace(/^[^…]*/, "").startsWith("…") && shown.includes("清单") && shown.length < 200, shown.slice(0, 60));
  await shoot("02_grid_description");

  // ── 3b. 命中别名技能的原名（网格卡片里的「别名: xxx」一行）──
  await typeInSearch("review");
  const byAlias = await evaluate(READ);
  record("搜索 review（别名原名）", byAlias);
  expect("别名技能的原名被高亮", byAlias.markTexts.includes("review"), byAlias.markTexts);
  await shoot("02b_grid_alias");

  // ── 4. 大小写不敏感 ──
  await typeInSearch("GAMMA");
  const upper = await evaluate(READ);
  record("搜索 GAMMA（大写）", upper);
  expect("大写搜索也高亮，且保留原文大小写", upper.nameMarks.includes("gamma"), upper.nameMarks);

  // ── 5. 列表视图同样高亮 ──
  await evaluate(`(() => { const btn = [...document.querySelectorAll('button')].find(b => /列表视图/.test(b.textContent) || b.getAttribute('aria-label') === '列表视图'); btn?.click(); return !!btn; })()`);
  await sleep(900);
  await typeInSearch("gamma");
  const list = await evaluate(READ);
  record("列表视图 + 搜索 gamma", list);
  expect("列表视图技能名高亮", list.nameMarks.includes("gamma"), list.nameMarks);
  await shoot("03_list_name");

  await typeInSearch("清单");
  const listDesc = await evaluate(READ);
  record("列表视图 + 搜索 清单", listDesc);
  expect("列表视图描述高亮", listDesc.descriptionMarks.includes("清单"), listDesc.descriptionMarks);
  await shoot("04_list_description");

  // ── 6. 描述深处命中：给出「描述命中」标签，并把命中处前后的文字前置 ──
  await typeInSearch("pyramid");
  const deep = await evaluate(READ);
  record("搜索 pyramid（原描述第 8 字起）", deep);
  expect("只剩 1 个技能", deep.cards === 1, deep.cards);
  expect("出现「描述命中」标签", deep.chipTexts.some(text => text.includes("描述命中")), deep.chipTexts);
  expect("标签 hover 给出命中位置", (deep.chipTitles[0] ?? "").includes("pyramid"), deep.chipTitles);
  expect("描述改成命中处前后的片段", deep.descriptionTexts.some(text => text.includes("pyramid") && text.startsWith("…") === false), deep.descriptionTexts);
  expect("片段仍带高亮", deep.descriptionMarks.includes("pyramid"), deep.descriptionMarks);
  await shoot("05_deep_description_grid");

  // ── 7. 名字命中时不需要标签（高亮本身已可见）──
  await typeInSearch("gamma");
  const nameOnly = await evaluate(READ);
  record("搜索 gamma（名字命中）", nameOnly);
  expect("名字命中不显示命中来源标签", nameOnly.chipTexts.length === 0, nameOnly.chipTexts);

  // ── 8. 列表视图：深层描述命中同样有标签 ──
  await evaluate(`(() => { const btn = [...document.querySelectorAll('button')].find(b => /列表视图/.test(b.textContent)); btn?.click(); return !!btn; })()`);
  await sleep(800);
  await typeInSearch("pyramid");
  const listDeep = await evaluate(READ);
  record("列表视图 + pyramid", listDeep);
  expect("列表视图也有「描述命中」标签", listDeep.chipTexts.some(text => text.includes("描述命中")), listDeep.chipTexts);
  await shoot("06_deep_description_list");

  // ── 9. 自定义说明命中：标签写「自定义说明命中」──
  await typeInSearch("对比度");
  const custom = await evaluate(READ);
  record("搜索 对比度（自定义说明）", custom);
  expect("自定义说明命中也标出来", custom.chipTexts.some(text => text.includes("说明命中")), custom.chipTexts);
  await shoot("07_custom_description_list");

  // ── 10. 高亮的视觉样式：有 accent 底色，不是浏览器默认黄 ──
  const style = await evaluate(`(() => { const m = document.querySelector('mark'); if (!m) return null; const s = getComputedStyle(m); return { bg: s.backgroundColor, color: s.color, radius: s.borderRadius }; })()`);
  record("高亮样式", style);
  expect("高亮用的是 accent 底色（非默认黄）", style !== null && style.bg !== "rgb(255, 255, 0)" && style.bg !== "rgba(0, 0, 0, 0)", style);
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
