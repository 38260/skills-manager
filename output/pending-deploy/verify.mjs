// 「部署覆盖 → N 项未部署」可展开名单的验收：隔离数据 + 真实后端 + 无头 Chrome。
// 覆盖：数字与名单一致、展开/收起、行点击进详情、Escape/外点关闭、三语言、全部署完成态、
//       深色与 960 窄窗口不溢出、面板不被卡片裁切。
// 用法：node output/pending-deploy/verify.mjs [tag]
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const tag = process.argv[2] ?? "run";
const root = path.resolve("output/pending-deploy");
// 每轮一个独立的数据目录，避免依赖删除/改名旧数据（本机删目录会走回收站并失败）。
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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "pending-deploy-profile-"));

const failures = [];
const results = [];
const record = (name, value) => { results.push({ name, value }); console.log(`· ${name}: ${JSON.stringify(value)}`); };
const expect = (name, condition, detail) => {
  if (condition) record(name, detail ?? "ok");
  else { failures.push({ name, detail }); record(name, { FAILED: detail }); }
};

// 先造隔离数据（独立 run 目录），再起后端，后端只会看到这一轮的数据。
await new Promise((resolve, reject) => {
  const seeded = spawn(NODE, [path.join(root, "seed.mjs")], {
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, PENDING_DEPLOY_DATA: dataRoot },
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

  // ── 造出「4 已部署 / 6 总数 / 2 未部署」的现场 ──
  const before = await invoke("get_managed_skills");
  if (before.length !== 6) throw new Error(`隔离库技能数异常：${before.length}（期望 6），请检查 seed`);
  const byName = name => {
    const skill = before.find(item => item.name === name);
    if (!skill) throw new Error(`隔离库缺少技能：${name}`);
    return skill;
  };
  const plan = [
    ["alpha-layout", "codex"],
    ["beta-review", "codex"],
    ["gamma-a11y", "claude_code"],
    ["delta-motion", "qoder"],
  ];
  for (const [name, tool] of plan) await invoke("sync_skill_to_tool", { skillId: byName(name).id, tool });
  const after = await invoke("get_managed_skills");
  const pending = after.filter(skill => skill.targets.length === 0).map(skill => skill.display_name || skill.name).sort();
  record("后端口径（已部署/总数）", { synced: after.length - pending.length, total: after.length, pending });
  expect("后端恰有 2 个未部署", pending.length === 2, pending);

  // 无头 Chrome 偶发启动失败（端口被抢/首启写 profile），这里最多重试两次并带上 stderr。
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
    await sleep(500);
  };
  const key = async (keyName) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: keyName, code: keyName, windowsVirtualKeyCode: keyName === "Escape" ? 27 : 0 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: keyName, code: keyName, windowsVirtualKeyCode: keyName === "Escape" ? 27 : 0 });
    await sleep(350);
  };
  const clickAt = async (x, y) => {
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    await sleep(400);
  };

  // 文案会随语言变化，这里的定位只依赖结构：卡片里唯一带 aria-controls 的展开按钮。
  const CARD = `[...document.querySelectorAll('section')].find(s => s.querySelector('button[aria-controls]'))`;
  const TRIGGER = `${CARD}?.querySelector('button[aria-controls]')`;
  const PANEL = `document.getElementById(${TRIGGER}?.getAttribute('aria-controls'))`;

  await send("Page.enable");
  await send("Runtime.enable");
  await goto(`http://127.0.0.1:${port}/`);
  await evaluate(`localStorage.setItem('theme','light'); localStorage.setItem('language','zh')`);
  await goto(`http://127.0.0.1:${port}/`);

  // ── 1. 收起态：卡片上的数字与文案 ──
  record("部署覆盖卡", await evaluate(`(() => {
    const card = ${CARD};
    return { text: card.textContent.replace(/\\s+/g,' ').trim(), bar: card.querySelector('[style*="width"]')?.getAttribute('style') ?? null };
  })()`));
  record("收起态触发入口", await evaluate(`(() => {
    const trigger = ${TRIGGER};
    return trigger ? { text: trigger.textContent.trim(), expanded: trigger.getAttribute('aria-expanded'), controls: !!trigger.getAttribute('aria-controls'), panel: !!${PANEL} } : null;
  })()`));
  expect("卡片显示 4 / 6 且 66.7%", await evaluate(`(() => { const text = ${CARD}.textContent.replace(/\\s+/g,' '); return text.includes('4 / 6') && text.includes('66.7%'); })()`));
  expect("默认收起，不渲染名单", await evaluate(`(() => { const trigger = ${TRIGGER}; return !!trigger && trigger.getAttribute('aria-expanded') === 'false' && !${PANEL}; })()`));
  await shoot("01_collapsed_light");

  // ── 2. 展开：名单必须就是那 2 个 ──
  await evaluate(`${TRIGGER}.click()`);
  await sleep(400);
  const panel = await evaluate(`(() => {
    const panel = ${PANEL};
    if (!panel) return null;
    const card = ${CARD};
    const trigger = ${TRIGGER};
    const rect = panel.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const rows = [...panel.querySelectorAll('li button')].map(button => button.textContent.trim());
    return {
      rows,
      title: panel.querySelector('p')?.textContent.trim(),
      hint: panel.lastElementChild?.textContent.trim(),
      rect: { top: Math.round(rect.top), bottom: Math.round(rect.bottom), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) },
      triggerBottom: Math.round(triggerRect.bottom),
      insideViewport: rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth,
      cardOverflow: getComputedStyle(card).overflow,
      zIndex: getComputedStyle(panel).zIndex,
      expanded: trigger.getAttribute('aria-expanded'),
    };
  })()`);
  record("展开后的名单", panel);
  expect("名单条数 = 未部署数", panel?.rows.length === 2, panel?.rows);
  expect("名单展示别名而非原名", panel?.rows.some(row => row.includes("文案规范")) && !panel.rows.some(row => row.includes("epsilon-copy")), panel?.rows);
  expect("长名技能也在名单里", panel?.rows.some(row => row.includes("zeta-perf-with-a-deliberately-long-name")), panel?.rows);
  expect("名单标题与提示存在", panel?.title === "未部署的技能" && panel?.hint === "点击技能名查看详情并部署", { title: panel?.title, hint: panel?.hint });
  expect("面板紧贴触发按钮下方且未被裁切", panel && panel.rect.top >= panel.triggerBottom && panel.cardOverflow === "visible", panel && { top: panel.rect.top, triggerBottom: panel.triggerBottom, overflow: panel.cardOverflow });
  expect("面板层级高于卡片内容", panel?.zIndex === "30", panel?.zIndex);
  expect("面板完整在视口内", panel?.insideViewport === true, panel?.rect);
  expect("展开后 aria-expanded=true", panel?.expanded === "true", panel?.expanded);
  await shoot("02_expanded_light");

  // ── 3. Escape 收起 ──
  await key("Escape");
  expect("Escape 收起面板", await evaluate(`!${PANEL} && ${TRIGGER}.getAttribute('aria-expanded') === 'false'`));

  // ── 4. 外部点击收起 ──
  await evaluate(`${TRIGGER}.click()`);
  await sleep(350);
  await clickAt(20, 20);
  expect("点击面板外收起", await evaluate(`!${PANEL}`));

  // ── 5. 行点击 → 打开该技能详情，且面板收起 ──
  await evaluate(`${TRIGGER}.click()`);
  await sleep(350);
  await evaluate(`[...${PANEL}.querySelectorAll('li button')].find(b => b.textContent.includes('文案规范')).click()`);
  await sleep(900);
  const opened = await evaluate(`(() => {
    const dialog = document.querySelector('.skill-detail-shell');
    return { open: !!dialog, label: dialog?.getAttribute('aria-label') ?? null, panelClosed: !${PANEL} };
  })()`);
  record("行点击后的详情", opened);
  expect("点击名单行打开对应技能详情", opened.open && opened.label === "文案规范", opened);
  expect("打开详情时面板已收起", opened.panelClosed === true, opened.panelClosed);
  await shoot("03_detail_from_list");
  await key("Escape");
  await sleep(400);

  // ── 6. 英文界面 ──
  await evaluate(`localStorage.setItem('language','en')`);
  await goto(`http://127.0.0.1:${port}/`);
  const english = await evaluate(`(() => {
    const trigger = ${TRIGGER};
    trigger.click();
    return new Promise(resolve => setTimeout(() => {
      const panel = ${PANEL};
      resolve({ trigger: trigger.textContent.trim(), title: panel?.querySelector('p')?.textContent.trim(), hint: panel?.lastElementChild?.textContent.trim(), rows: panel ? [...panel.querySelectorAll('li button')].map(b => b.textContent.trim()) : [] });
    }, 350));
  })()`, true);
  record("英文界面", english);
  expect("英文文案完整", english.trigger === "2 not deployed" && english.title === "Skills not deployed" && english.rows.length === 2, english);
  await shoot("04_expanded_en");
  await evaluate(`localStorage.setItem('language','zh')`);

  // ── 7. 深色 + 960 窄窗口 ──
  await evaluate(`localStorage.setItem('theme','dark')`);
  await goto(`http://127.0.0.1:${port}/`);
  await evaluate(`${TRIGGER}.click()`);
  await sleep(400);
  await shoot("05_expanded_dark");
  record("深色面板配色", await evaluate(`(() => {
    const panel = ${PANEL};
    const row = panel.querySelector('li button span');
    return { background: getComputedStyle(panel).backgroundColor, panelText: getComputedStyle(panel.querySelector('p')).color, rowText: getComputedStyle(row).color };
  })()`));
  await evaluate(`localStorage.setItem('theme','light')`);

  await viewport(960, 1000);
  await goto(`http://127.0.0.1:${port}/`);
  await evaluate(`${TRIGGER}.click()`);
  await sleep(400);
  const narrow = await evaluate(`(() => {
    const panel = ${PANEL};
    const rect = panel.getBoundingClientRect();
    return { scrollWidthDelta: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      rect: { left: Math.round(rect.left), right: Math.round(rect.right) }, innerWidth,
      insideViewport: rect.left >= 0 && rect.right <= innerWidth };
  })()`);
  record("960 窄窗口", narrow);
  expect("窄窗口无横向溢出", narrow.scrollWidthDelta === 0, narrow.scrollWidthDelta);
  expect("窄窗口面板仍在视口内", narrow.insideViewport === true, narrow.rect);
  await shoot("06_expanded_narrow");
  await viewport(1536, 1024);

  // ── 8. 全部部署后：换成确认文案，入口消失 ──
  const remainder = (await invoke("get_managed_skills")).filter(skill => skill.targets.length === 0);
  for (const skill of remainder) await invoke("sync_skill_to_tool", { skillId: skill.id, tool: "codex" });
  const done = await invoke("get_managed_skills");
  record("全部署后的后端口径", { pending: done.filter(skill => skill.targets.length === 0).length, total: done.length });

  await goto(`http://127.0.0.1:${port}/`);
  // 全部署后展开按钮本身消失，不能再靠 aria-controls 定位，改用统计卡结构位（第二张卡）。
  const finished = await evaluate(`(() => {
    const card = [...document.querySelectorAll('section.app-panel')][1];
    return {
      title: card.querySelector('.app-section-title')?.textContent.trim(),
      text: card.textContent.replace(/\\s+/g,' ').trim(),
      triggers: card.querySelectorAll('button').length,
      percent: card.textContent.includes('100%'),
    };
  })()`);
  record("全部部署完成态", finished);
  expect("全部署后显示确认文案且无展开入口",
    finished.title === "部署覆盖" && finished.text.includes("全部技能已部署") && finished.triggers === 0 && finished.percent === true,
    finished);
  await shoot("07_all_deployed");
} catch (error) {
  // 脚本级异常同样要落进报告，避免"只有退出码没有证据"。
  failures.push({ name: "脚本异常", detail: String(error?.stack ?? error) });
  console.error(`✗ 脚本异常：${error?.message ?? error}`);
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  try { chrome?.kill(); } catch { /* ignore */ }
  try { server.kill(); } catch { /* ignore */ }
  await sleep(400);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
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
