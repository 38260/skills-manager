// 「查看上下文 / 命中内容」顺序与默认展开的验收：真实后端 + 真实会话文件 + 无头 Chrome。
// 覆盖：上下文排在命中内容之前、默认展开、可收起/展开、原文仍默认折叠。
// 用法：node output/evidence-order/verify.mjs [tag]
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const tag = process.argv[2] ?? "run";
const root = path.resolve("output/evidence-order");
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

await new Promise((resolve, reject) => {
  const seeded = spawn(NODE, [path.join(root, "seed.mjs")], {
    stdio: "ignore", windowsHide: true, env: { ...process.env, EVIDENCE_ORDER_DATA: dataRoot },
  });
  seeded.on("exit", code => (code === 0 ? resolve() : reject(new Error(`seed 失败：${code}`))));
});

const port = await freePort();
const debugPort = await freePort();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-order-profile-"));
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

  const CARD = `document.querySelector('[data-testid="activity-evidence"]')`;
  const DETAILS = `[...${CARD}.querySelectorAll(':scope > details')]`;

  await send("Page.enable");
  await send("Runtime.enable");
  await goto(`http://127.0.0.1:${port}/`);
  await evaluate(`localStorage.setItem('theme','light'); localStorage.setItem('language','zh')`);
  await goto(`http://127.0.0.1:${port}/skill-activity`);

  // 选中第一条（seed 里时间最新、带真实会话文件的那条）
  await evaluate(`(() => { const row = [...document.querySelectorAll('[role="button"]')].find(el => el.getAttribute('aria-pressed') !== null); row.click(); return true; })()`);
  await sleep(1400);

  const snapshot = await evaluate(`(() => {
    const card = ${CARD};
    if (!card) return { error: '没有证据卡片' };
    const details = ${DETAILS};
    return {
      detailCount: details.length,
      openFlags: details.map(el => el.open),
      summaries: details.map(el => el.querySelector('summary')?.textContent.replace(/\\s+/g, ' ').trim()),
      // 结构顺序：上下文 details 必须在命中内容之前
      order: [...card.children].map(el => el.tagName.toLowerCase() === 'details'
        ? el.querySelector('summary')?.textContent.replace(/\\s+/g, ' ').trim()
        : el.textContent.replace(/\\s+/g, ' ').trim().slice(0, 12)),
      contextVisible: (() => {
        const first = details[0];
        return first ? first.getBoundingClientRect().height > 60 : null;
      })(),
      roles: [...(details[0]?.querySelectorAll('li') ?? [])].map(li => li.textContent.replace(/\\s+/g, ' ').trim().slice(0, 18)),
      contentHeading: card.querySelector('h5')?.textContent.trim(),
    };
  })()`);
  record("证据卡片结构", snapshot);
  expect("详情里有上下文与原文两个折叠块", snapshot.detailCount === 2, snapshot.detailCount);
  expect("上下文是第一个块（排在命中内容之前）", snapshot.order?.[0]?.startsWith("查看上下文"), snapshot.order);
  expect("命中内容夹在上下文与原文之间", String(snapshot.contentHeading) === "命中内容" && snapshot.order?.[2]?.startsWith("查看原始记录"), { order: snapshot.order, heading: snapshot.contentHeading });
  expect("上下文默认展开", snapshot.openFlags?.[0] === true, snapshot.openFlags);
  expect("原文仍默认折叠", snapshot.openFlags?.[1] === false, snapshot.openFlags);
  expect("上下文里解析出多行（可见高度 > 60px）", snapshot.contextVisible === true, snapshot.contextVisible);
  expect("上下文渲染出角色条目", (snapshot.roles?.length ?? 0) >= 2, snapshot.roles);
  await shoot("01_default_open");

  // 收起上下文：内容应隐藏，命中内容不受影响
  const collapse = await evaluate(`(() => {
    const card = ${CARD};
    const details = ${DETAILS};
    details[0].querySelector('summary').click();
    return new Promise(resolve => setTimeout(() => resolve({
      open: details[0].open,
      height: Math.round(details[0].getBoundingClientRect().height),
      contentStillThere: card.querySelector('h5')?.textContent.trim() === '命中内容',
    }), 400));
  })()`, true);
  record("收起上下文", collapse);
  expect("点标题可收起上下文", collapse.open === false && collapse.height < 60, collapse);
  expect("收起上下文不影响命中内容", collapse.contentStillThere === true, collapse.contentStillThere);

  // 再展开
  const reopen = await evaluate(`(() => {
    const details = ${DETAILS};
    details[0].querySelector('summary').click();
    return new Promise(resolve => setTimeout(() => resolve({ open: details[0].open }), 400));
  })()`, true);
  expect("可以再次展开上下文", reopen.open === true, reopen);

  // 暗色
  await evaluate(`localStorage.setItem('theme','dark')`);
  await goto(`http://127.0.0.1:${port}/skill-activity`);
  await evaluate(`(() => { const row = [...document.querySelectorAll('[role="button"]')].find(el => el.getAttribute('aria-pressed') !== null); row.click(); return true; })()`);
  await sleep(1400);
  await shoot("02_default_open_dark");
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
