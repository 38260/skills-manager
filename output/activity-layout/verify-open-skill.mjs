// 验证「调用记录 → 技能详情 → 回来」这条链路：
//   ① 右栏能给出一条记录的可跳转入口（并按严格/名称兜底分别标注）；
//   ② 点「打开技能详情」后弹层出现，且**当前路由仍是调用记录页**（不再被带去技能库）；
//   ③ 关掉弹层后回到调用记录页，列表与选中项还在。
// ⚠️ 用真实库，截图含真实数据，写进已 gitignore 的 shots/。
// 用法：npm run build && node output/activity-layout/verify-open-skill.mjs
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

const outDir = path.resolve("output/activity-layout/shots");
fs.mkdirSync(outDir, { recursive: true });

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(candidate => fs.existsSync(candidate));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  probe.on("error", reject);
});

const port = await freePort();
const debugPort = await freePort();
const profile = fs.mkdtempSync(path.join(process.env.TEMP ?? "/tmp", "verify-open-skill-"));
const server = spawn(process.execPath, ["backend/server.mjs", "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let log = "";
server.stdout.on("data", chunk => { log += chunk; });
server.stderr.on("data", chunk => { log += chunk; });

let chrome, ws;
const results = [];
const check = (label, ok, detail = "") => { results.push({ label, ok }); console.log(`${ok ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`); };

try {
  const deadline = Date.now() + 25000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* 等就绪 */ }
    if (Date.now() > deadline) throw new Error(`服务未就绪：${log}`);
    await sleep(150);
  }
  chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--force-device-scale-factor=1", `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*",
    `--user-data-dir=${profile}`, "--window-size=1440,900"], { stdio: "ignore" });
  let target = null;
  for (let index = 0; index < 160 && !target; index++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      target = list.find(item => item.type === "page" && item.webSocketDebuggerUrl);
    } catch { /* 等端口 */ }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error("找不到可调试的页面目标");
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
  const shoot = async name => {
    const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(shot.data, "base64"));
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/skill-activity` });
  await sleep(6000);

  // 逐条点开，统计右栏出现「打开技能详情」的比例，并记录其中一条用于走完整链路
  const scan = await evaluate(`(async () => {
    const rows = [...document.querySelectorAll("button[aria-pressed]")];
    const out = { rows: rows.length, linked: 0, byName: 0, unlinked: 0 };
    for (const row of rows) {
      row.click();
      await new Promise(r => setTimeout(r, 90));
      const aside = document.querySelector("aside");
      if (!aside) continue;
      if ([...aside.querySelectorAll("button")].some(b => b.textContent.includes("打开技能详情"))) {
        out.linked++;
        if (aside.textContent.includes("按技能名匹配")) out.byName++;
      } else if (aside.textContent.includes("未关联技能库")) out.unlinked++;
    }
    return out;
  })()`, true);
  check("右栏给出「打开技能详情」入口", scan.linked > 0, `已关联 ${scan.linked} 条（其中按名称兜底 ${scan.byName}）／未关联 ${scan.unlinked} 条／共 ${scan.rows} 行`);

  // 走完整链路：点开详情 → 看路由 → 关掉 → 回到调用记录
  const opened = await evaluate(`(async () => {
    const rows = [...document.querySelectorAll("button[aria-pressed]")];
    for (const row of rows) {
      row.click();
      await new Promise(r => setTimeout(r, 120));
      const button = [...document.querySelectorAll("aside button")].find(b => b.textContent.includes("打开技能详情"));
      if (!button) continue;
      const selectedLabel = row.textContent.trim().slice(0, 20);
      button.click();
      await new Promise(r => setTimeout(r, 1600));
      const shell = document.querySelector(".skill-detail-shell");
      return { clicked: true, selectedLabel, detailOpen: Boolean(shell), pathAfterOpen: location.pathname, backLabel: [...(shell?.querySelectorAll("button") ?? [])].map(b => b.textContent.trim()).find(t => t === "返回" || t === "返回技能库") ?? null };
    }
    return { clicked: false };
  })()`, true);
  await shoot("open-skill-detail");
  check("点开后技能详情弹层打开", opened.detailOpen === true, JSON.stringify(opened));
  check("打开详情后当前路由不变（仍在调用记录）", opened.pathAfterOpen === "/skill-activity", `pathname=${opened.pathAfterOpen}`);
  check("从调用记录打开时返回按钮写「返回」而非「返回技能库」", opened.backLabel === "返回", `实际=${opened.backLabel}`);

  const closed = await evaluate(`(async () => {
    const shell = document.querySelector(".skill-detail-shell");
    const back = [...(shell?.querySelectorAll("button") ?? [])].find(b => b.textContent.trim() === "返回");
    back?.click();
    await new Promise(r => setTimeout(r, 900));
    return {
      detailOpen: Boolean(document.querySelector(".skill-detail-shell")),
      path: location.pathname,
      hasRows: document.querySelectorAll("button[aria-pressed]").length,
      hasDetailPanel: Boolean([...document.querySelectorAll("aside")].find(a => a.textContent.includes("记录详情"))),
    };
  })()`, true);
  await shoot("after-back");
  check("关掉详情后回到调用记录页", !closed.detailOpen && closed.path === "/skill-activity", JSON.stringify(closed));
  check("返回后列表与右栏仍在", closed.hasRows > 0 && closed.hasDetailPanel === true, `列表 ${closed.hasRows} 行`);

  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} 项通过`);
  fs.writeFileSync(path.resolve("output/activity-layout/result.json"), JSON.stringify({ at: new Date().toISOString(), scan, results }, null, 2));
  process.exitCode = failed ? 1 : 0;
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  try { chrome?.kill(); } catch { /* ignore */ }
  try { server.kill(); } catch { /* ignore */ }
  await sleep(300);
}
