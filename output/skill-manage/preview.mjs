// 技能管理能力的真实浏览器复核：真实技能库 + 隔离 home（调用记录库为真实库的副本），
// 验证别名／自定义说明／作者编辑、调用统计展示、筛选单选互斥。
// 编辑验证采用「写入 → 断言 → 清空 → 断言还原」的往返方式，结束后技能库回到原状。
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const LIBRARY = process.env.SKILLS_MANAGER_DIR || path.join(os.homedir(), ".skills-manager");
const ACTIVITY = process.env.SKILLS_MANAGER_ACTIVITY_DIR || path.join(os.homedir(), ".skills-manager-activity");
const evidence = path.resolve("output/skill-manage/evidence");
fs.mkdirSync(evidence, { recursive: true });

const NODE = process.execPath;
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  probe.on("error", reject);
});

const home = fs.mkdtempSync(path.join(os.tmpdir(), "skill-manage-home-"));
// 复制真实调用记录库，让统计有真实数据，同时不写用户的原始文件。
if (fs.existsSync(ACTIVITY)) fs.cpSync(ACTIVITY, path.join(home, ".skills-manager-activity"), { recursive: true });

const port = await freePort();
const debugPort = await freePort();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "skill-manage-profile-"));
const server = spawn(NODE, ["backend/server.mjs", "--port", String(port), "--directory", LIBRARY, "--home", home],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let log = "";
server.stdout.on("data", c => { log += c; });
server.stderr.on("data", c => { log += c; });

const results = [];
const record = (name, value) => { results.push({ name, value }); console.log(`· ${name}: ${JSON.stringify(value)}`); };

let chrome, ws;
try {
  const deadline = Date.now() + 20000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* 等待服务 */ }
    if (Date.now() > deadline) throw new Error(`本地服务未就绪：${log}`);
    await sleep(150);
  }
  chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*", `--user-data-dir=${profile}`,
    "--window-size=1536,1200", "about:blank"], { stdio: "ignore" });
  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      target = list.find(item => item.type === "page" && item.webSocketDebuggerUrl);
    } catch { /* 等待 Chrome */ }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error("找不到可调试的页面目标");

  ws = new WebSocket(target.webSocketDebuggerUrl);
  if (ws.readyState !== 1) await new Promise(r => ws.addEventListener("open", r, { once: true }));
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
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(`表达式失败：${result.exceptionDetails.text}`);
    return result.result?.value;
  };
  const shoot = async (name, full = false) => {
    const height = full ? Math.min(await evaluate("Math.max(document.scrollingElement.scrollHeight, document.body.scrollHeight)"), 20000) : null;
    const shot = await send("Page.captureScreenshot", { format: "png", ...(full ? { captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1536, height, scale: 1 } } : {}) });
    fs.writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(shot.data, "base64"));
    console.log(`  SHOT ${name}.png${full ? ` (${height}px)` : ""}`);
  };
  const goto = async url => { await send("Page.navigate", { url }); await sleep(2600); };
  const cardCount = `document.querySelectorAll('.app-panel').length`;
  const cardTexts = `[...document.querySelectorAll('.app-panel')].map(el => el.textContent.replace(/\\s+/g,' ').trim())`;

  await send("Page.enable");
  await send("Runtime.enable");
  await goto(`http://127.0.0.1:${port}/my-skills`);
  await evaluate(`localStorage.setItem('theme','light')`);
  await goto(`http://127.0.0.1:${port}/my-skills`);

  // ── 调用统计 ──
  const texts = await evaluate(cardTexts);
  record("调用统计展示", {
    cards: texts.length,
    withCount: texts.filter(t => /调用 \d+ 次/.test(t)).length,
    never: texts.filter(t => t.includes("从未使用")).length,
    sample: texts.filter(t => /调用 \d+ 次/.test(t)).slice(0, 3).map(t => t.slice(-40)),
  });
  await shoot("01_cards_usage");
  await shoot("01_cards_usage_full", true);

  // ── 筛选单选互斥 ──
  const clickChip = label => `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith(${JSON.stringify(label)})); if (!b) return false; b.click(); return true; })()`;
  await evaluate(clickChip("学术科研"));
  await sleep(900);
  const afterCategory = await evaluate(cardCount);
  await evaluate(clickChip("本地"));
  await sleep(900);
  const afterSource = await evaluate(cardCount);
  record("筛选单选互斥", { afterCategory, afterSource, sourceChipActive: await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '本地'); return !!b && b.className.includes('bg-accent'); })()`), categoryChipActive: await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('学术科研')); return !!b && b.className.includes('text-white'); })()`) });
  await evaluate(clickChip("本地"));
  await sleep(700);
  await evaluate(clickChip("学术科研"));
  await sleep(900);
  record("反向：选分类后来源被清空", { cards: await evaluate(cardCount), sourceChipActive: await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '本地'); return !!b && b.className.includes('bg-accent'); })()`) });
  await shoot("02_filter_single");
  await evaluate(clickChip("学术科研"));
  await sleep(700);

  // ── 编辑技能信息（写入 → 断言 → 清空 → 断言还原） ──
  const openEditor = `(() => {
    const card = [...document.querySelectorAll('.app-panel')].find(el => el.querySelector('h3')?.textContent.trim() === 'playwright');
    if (!card) return 'no-card';
    const menu = card.querySelector('button[aria-label="更多操作"]');
    if (!menu) return 'no-menu';
    menu.click(); return 'opened';
  })()`;
  record("打开卡片菜单", await evaluate(openEditor));
  await sleep(500);
  record("点击编辑信息", await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '编辑信息'); if (!b) return false; b.click(); return true; })()`));
  await sleep(700);
  await shoot("03_profile_dialog");
  const fill = `(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return 'no-dialog';
    const set = (el, value) => { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const inputs = dialog.querySelectorAll('input');
    const textarea = dialog.querySelector('textarea');
    set(inputs[0], '浏览器自动化'); set(textarea, '团队统一说明：用真实浏览器跑端到端回归。'); set(inputs[1], '自动化小组');
    return [...dialog.querySelectorAll('input')].map(el => el.value);
  })()`;
  record("填写表单", await evaluate(fill));
  await evaluate(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => x.textContent.trim() === '保存'); if (b) b.click(); return true; })()`);
  await sleep(1800);
  const savedTexts = await evaluate(cardTexts);
  const savedCard = savedTexts.find(t => t.includes("浏览器自动化"));
  record("保存后卡片", {
    hasAlias: !!savedCard,
    cardText: savedCard ? savedCard.slice(0, 120) : null,
    dialogClosed: await evaluate(`!document.querySelector('[role="dialog"]')`),
  });
  await shoot("04_after_save");

  // 打开详情，确认页头也显示别名与自定义作者
  await evaluate(`(() => { const card = [...document.querySelectorAll('.app-panel')].find(el => el.textContent.includes('浏览器自动化')); if (card) card.click(); return true; })()`);
  await sleep(1500);
  record("详情页头", await evaluate(`(() => { const header = document.querySelector('.skill-detail-header'); return header ? header.textContent.replace(/\\s+/g,' ').trim().slice(0, 140) : null; })()`));
  await shoot("05_detail_with_alias");
  await evaluate(`(() => { const b = [...document.querySelectorAll('.skill-detail-header button')].find(x => x.textContent.trim() === '编辑信息'); if (b) b.click(); return true; })()`);
  await sleep(800);
  record("详情页可打开编辑", await evaluate(`!!document.querySelector('[role="dialog"]')`));
  // 清空还原
  await evaluate(`(() => { const dialog = document.querySelector('[role="dialog"]');
    const set = (el, value) => { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set(dialog.querySelectorAll('input')[0], ''); set(dialog.querySelector('textarea'), ''); set(dialog.querySelectorAll('input')[1], '');
    return true; })()`);
  await evaluate(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => x.textContent.trim() === '保存'); if (b) b.click(); return true; })()`);
  await sleep(1800);
  const clearedTexts = await evaluate(cardTexts);
  record("清空后还原", {
    aliasGone: !clearedTexts.some(t => t.includes("浏览器自动化")),
    playwrightCard: clearedTexts.find(t => t.includes("playwright"))?.slice(0, 100) ?? null,
  });

  await evaluate(`localStorage.setItem('theme','dark')`);
  await goto(`http://127.0.0.1:${port}/my-skills`);
  await shoot("06_cards_dark");

  fs.writeFileSync(path.join(evidence, "report.json"), JSON.stringify(results, null, 2));
  console.log("\n复核完成，证据在 output/skill-manage/evidence/");
} catch (error) {
  console.error("复核中断：", error.message);
  fs.writeFileSync(path.join(evidence, "report.json"), JSON.stringify({ error: error.message, results }, null, 2));
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* 忽略 */ }
  chrome?.kill(); server.kill();
  await sleep(500);
  fs.rmSync(profile, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
  process.exit(process.exitCode ?? 0);
}
