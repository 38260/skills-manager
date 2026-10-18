// 用 CDP 驱动系统 Chrome 验证：调用记录页点「全部记录 / 明确调用 / 已确认加载 / 仅请求」时，
// 统计条与页签上的数字必须保持不变（只换列表内容）。
// 依赖 Node 22 自带的全局 WebSocket，无需安装依赖。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const url = process.argv[2] || "http://127.0.0.1:14399/skill-activity";
const port = process.argv[3] || "9333";
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = path.join(os.tmpdir(), `facet-probe-${process.pid}-${Date.now()}`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const browser = spawn(chrome, [
  "--headless=new", "--no-proxy-server", "--no-first-run", "--disable-gpu",
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore", windowsHide: true });

let socket;
const pending = new Map();
let sequence = 0;
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

process.on("exit", () => { try { browser.kill(); } catch { /* 已退出 */ } });

try {
  let version;
  for (let i = 0; i < 50; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; }
    catch { await sleep(200); }
  }
  if (!version) throw new Error("Chrome 调试端口未就绪");
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    const waiter = message.id && pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
  };

  const { targetId } = await send("Target.createTarget", { url });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);

  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "页面脚本报错");
    return result.result.value;
  };

  const snapshot = () => evaluate(`(() => {
    const card = document.querySelector(".grid.grid-cols-2");
    const stats = card ? [...card.children].map(cell => ({ label: cell.children[0]?.textContent.trim(), value: cell.children[1]?.textContent.trim() })) : [];
    const tabs = [...document.querySelectorAll('[role="tab"]')].map(tab => ({
      label: tab.childNodes[0]?.textContent.trim(),
      count: tab.querySelector("span")?.textContent.trim(),
      selected: tab.getAttribute("aria-selected"),
    }));
    return {
      stats, tabs,
      rows: document.querySelectorAll("button[aria-pressed]").length,
      footer: document.querySelector("footer span[aria-live]")?.textContent.trim() ?? "",
    };
  })()`);

  // 等首屏结果：统计条出现真实数字、四个页签就位。
  for (let i = 0; i < 60; i++) {
    const ready = await evaluate(`(() => {
      const card = document.querySelector(".grid.grid-cols-2");
      const tabs = document.querySelectorAll('[role="tab"]');
      if (!card || tabs.length !== 4) return false;
      return [...card.children].every(cell => /^\\d+$/.test(cell.children[1]?.textContent.trim() ?? ""));
    })()`);
    if (ready) break;
    await sleep(250);
  }

  const baseline = await snapshot();
  const numeric = view => ({
    stats: view.stats.map(item => Number(item.value)),
    tabs: view.tabs.map(tab => Number(tab.count)),
  });
  const base = numeric(baseline);
  const checks = [];
  const order = [1, 2, 3, 0, 2, 1];
  for (const index of order) {
    await evaluate(`document.querySelectorAll('[role="tab"]')[${index}].click()`);
    for (let i = 0; i < 40; i++) {
      const selected = await evaluate(`document.querySelectorAll('[role="tab"]')[${index}].getAttribute("aria-selected") === "true"`);
      if (selected) break;
      await sleep(100);
    }
    await sleep(400);
    const view = await snapshot();
    const current = numeric(view);
    const same = JSON.stringify(current.stats) === JSON.stringify(base.stats)
      && JSON.stringify(current.tabs) === JSON.stringify(base.tabs);
    checks.push({ clicked: view.tabs[index].label, same, stats: current.stats, tabCounts: current.tabs, rows: view.rows, footer: view.footer });
  }
  const report = { url, baseline: base, checks, pass: checks.every(check => check.same) };
  fs.writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.slice(1)), "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
} finally {
  try { socket?.close(); } catch { /* 忽略 */ }
  browser.kill();
  await sleep(200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 占用时留给系统清理 */ }
}
