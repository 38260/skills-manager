// 技能详情打开后，侧边栏点击应关闭浮层并跳到目标路由。
// 使用隔离数据、真实本地服务和临时无头 Chrome，不读写用户技能库。
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const tag = process.argv[2] ?? "run";
const root = path.resolve("output/sidebar-nav-detail");
const runId = `run-${tag}-${Date.now()}`;
const dataRoot = path.join(root, "data", runId);
const home = path.join(dataRoot, "home");
const report = path.join(root, "report.json");

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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sidebar-nav-detail-"));
const results = [];
const failures = [];
const record = (name, value) => { results.push({ name, value }); if (value && typeof value === "object" && "FAILED" in value) failures.push(name); };
const expect = (name, condition, detail = "ok") => record(name, condition ? detail : { FAILED: detail });

await new Promise((resolve, reject) => {
  const seeded = spawn(process.execPath, [path.join(root, "seed.mjs")], {
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    env: { ...process.env, SIDEBAR_NAV_DETAIL_DATA: dataRoot },
  });
  let log = "";
  seeded.stdout.on("data", chunk => { log += chunk; });
  seeded.stderr.on("data", chunk => { log += chunk; });
  seeded.on("exit", code => (code === 0 ? resolve(log) : reject(new Error(`seed 失败：exit ${code}\n${log}`))));
});

const server = spawn(process.execPath, [
  "backend/server.mjs", "--port", String(port),
  "--directory", path.join(home, ".skills-manager"), "--home", home,
], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
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
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* 等待服务 */ }
    if (Date.now() > deadline) throw new Error(`本地服务未就绪：${serverLog}`);
    await sleep(150);
  }

  let target = null;
  chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*",
    `--user-data-dir=${profile}`, "--window-size=1536,1024", "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let chromeLog = "";
  chrome.stdout.on("data", chunk => { chromeLog += chunk; });
  chrome.stderr.on("data", chunk => { chromeLog += chunk; });
  for (let index = 0; index < 80 && !target; index++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      target = list.find(item => item.type === "page" && item.webSocketDebuggerUrl);
    } catch { /* 等端口 */ }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error(`找不到可调试页面：${chromeLog.slice(0, 400)}`);

  ws = new WebSocket(target.webSocketDebuggerUrl);
  if (ws.readyState !== 1) await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params ?? {} }));
  });
  const evaluate = async (expression, awaitPromise = false) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result?.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await invoke("set_settings", { key: "language", value: "zh" });
  await invoke("set_settings", { key: "theme", value: "light" });
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/my-skills` });
  await sleep(2500);
  await evaluate(`localStorage.setItem('language','zh'); localStorage.setItem('theme','light')`);
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/my-skills` });
  await sleep(2500);

  const openDetail = async () => evaluate(`(async () => {
    const waitFor = async (test, tries = 60) => {
      for (let index = 0; index < tries; index++) {
        const value = test();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      return null;
    };
    const shell = await waitFor(() => document.querySelector('.skill-detail-shell'));
    if (shell) return true;
    const card = await waitFor(() => [...document.querySelectorAll('.app-panel')]
      .find(element => element.textContent.includes('nav-detail-demo')));
    if (!card) return { ok: false, reason: 'card-not-found', panels: document.querySelectorAll('.app-panel').length };
    card.click();
    return await waitFor(() => document.querySelector('.skill-detail-shell')) ? true : { ok: false, reason: 'dialog-not-opened' };
  })()`, true);

  const sidebarControl = name => `(() => {
    const sidebar = [...document.querySelectorAll('div')]
      .find(element => typeof element.className === 'string'
        && element.className.includes('w-[220px]')
        && element.className.includes('flex-col'));
    return sidebar && [...sidebar.querySelectorAll('a, button')]
      .find(control => control.textContent.trim() === ${JSON.stringify(name)});
  })()`;

  const openedInitial = await openDetail();
  expect("打开隔离技能详情", openedInitial === true, openedInitial);

  const initialUrl = await evaluate("location.pathname");
  const clickedLibrary = await evaluate(`(async () => {
    const control = ${sidebarControl("技能库")};
    if (!control) return { clicked: false, reason: 'sidebar-control-not-found' };
    control.click();
    await new Promise(resolve => setTimeout(resolve, 500));
    return {
      clicked: true,
      dialog: !!document.querySelector('.skill-detail-shell'),
      path: location.pathname,
      breadcrumb: document.body.innerText.includes('技能库 / nav-detail-demo'),
    };
  })()`, true);
  record("当前页技能库点击", clickedLibrary);
  expect("详情打开时点击技能库会关闭浮层", clickedLibrary?.dialog === false, clickedLibrary);
  expect("点击技能库后仍停留在技能库路由", clickedLibrary?.path === initialUrl && initialUrl === "/my-skills", { initialUrl, after: clickedLibrary?.path });
  expect("详情关闭后顶部详情面包屑消失", clickedLibrary?.breadcrumb === false, clickedLibrary);

  const navigationCases = [
    ["调用记录", "/skill-activity"],
    ["全部 Agents", "/global-workspace"],
    ["设置", "/settings"],
  ];
  for (const [label, expectedPath] of navigationCases) {
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/my-skills` });
    await sleep(1200);
    const opened = await openDetail();
    expect(`打开详情后点「${label}」前的详情存在`, opened === true, opened);
    const clicked = await evaluate(`(async () => {
      const control = ${sidebarControl(label)};
      if (!control) return { clicked: false, reason: 'sidebar-control-not-found' };
      control.click();
      await new Promise(resolve => setTimeout(resolve, 650));
      return { clicked: true, dialog: !!document.querySelector('.skill-detail-shell'), path: location.pathname };
    })()`, true);
    record(`详情打开时点击「${label}」`, clicked);
    expect(`点「${label}」会关闭技能详情`, clicked?.dialog === false, clicked);
    expect(`点「${label}」进入目标路由`, clicked?.path === expectedPath, clicked);
  }

  // 切到其他路由后再用侧边栏点「技能库」，确认没有详情残留。
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/settings` });
  await sleep(1200);
  const libraryFromSettings = await evaluate(`(async () => {
    const control = ${sidebarControl("技能库")};
    if (!control) return { clicked: false, reason: 'sidebar-control-not-found' };
    control.click();
    await new Promise(resolve => setTimeout(resolve, 500));
    return { dialog: !!document.querySelector('.skill-detail-shell'), path: location.pathname };
  })()`, true);
  record("从设置返回技能库", libraryFromSettings);
  expect("无详情时侧边栏跳转仍正常", libraryFromSettings?.dialog === false && libraryFromSettings?.path === "/my-skills", libraryFromSettings);
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  if (chrome) { try { chrome.kill(); } catch { /* ignore */ } }
  if (server) { try { server.kill(); } catch { /* ignore */ } }
}

fs.writeFileSync(report, JSON.stringify({ tag, runId, failures, results }, null, 2));
console.log(`\n${results.length - failures.length}/${results.length} 通过`);
if (failures.length) {
  console.error("失败项：", failures.join("、"));
  process.exitCode = 1;
}
