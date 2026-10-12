// 调用记录页的布局探测：在几个常见窗口宽度下打开页面，量出
//   ① 列表与详情是并排还是上下；
//   ② 点一条记录后，详情落到视口的什么位置（有没有被顶到最顶部）；
//   ③ 并排时滚动列表，详情栏是否吸顶跟随。
// ⚠️ 用真实技能库与调用记录，截图含真实数据，写进已 gitignore 的 shots/，不要提交。
// 用法：npm run build && node output/activity-layout/inspect.mjs [宽度...]
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

const outDir = path.resolve("output/activity-layout/shots");
fs.mkdirSync(outDir, { recursive: true });
const WIDTHS = (process.argv.slice(2).length ? process.argv.slice(2) : ["1440", "1200", "1100", "960"]).map(Number);
const HEIGHT = 900;

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
const profile = fs.mkdtempSync(path.join(process.env.TEMP ?? "/tmp", "activity-layout-"));
const server = spawn(process.execPath, ["backend/server.mjs", "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let log = "";
server.stdout.on("data", chunk => { log += chunk; });
server.stderr.on("data", chunk => { log += chunk; });

let chrome, ws;
try {
  const deadline = Date.now() + 25000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* 等就绪 */ }
    if (Date.now() > deadline) throw new Error(`服务未就绪：${log}`);
    await sleep(150);
  }
  chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--force-device-scale-factor=1", `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*",
    `--user-data-dir=${profile}`, `--window-size=${WIDTHS[0]},${HEIGHT}`], { stdio: "ignore" });
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

  // 列表面板：右侧详情 aside 的前一个兄弟；滚动容器是祖先里第一个 overflowY 可滚的。
  const PROBE = `(() => {
    const aside = document.querySelector("aside");
    const panel = aside?.previousElementSibling;
    const list = panel?.querySelector("div.min-w-0") ?? panel;
    let scroller = panel?.parentElement, node = panel;
    while (scroller && scroller !== document.body) {
      const style = getComputedStyle(scroller);
      if (/(auto|scroll)/.test(style.overflowY)) break;
      node = scroller; scroller = scroller.parentElement;
    }
    const a = aside.getBoundingClientRect();
    // 行是 <button aria-pressed>（表格形态但用 button 承载点击），不是 [role=row]
    const rows = panel?.querySelectorAll("button[aria-pressed]").length ?? 0;
    return {
      innerWidth: window.innerWidth,
      rows,
      listPanelHeight: Math.round(panel.getBoundingClientRect().height),
      detailTop: Math.round(a.top), detailLeft: Math.round(a.left), detailHeight: Math.round(a.height),
      listHeight: list ? Math.round(list.getBoundingClientRect().height) : null,
      scrollTop: scroller ? Math.round(scroller.scrollTop) : null,
      scrollerTag: scroller ? scroller.className.toString().slice(0, 40) : null,
    };
  })()`;

  for (const width of WIDTHS) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/skill-activity` });
    await sleep(4500);
    const before = await evaluate(PROBE);
    await evaluate(`(() => { const rows = document.querySelectorAll("button[aria-pressed]"); (rows[2] ?? rows[0])?.click(); return rows.length; })()`);
    await sleep(1400);
    const afterClick = await evaluate(PROBE);
    // 再往下滚 500px，看详情栏是否吸顶跟随（并排时应当纹丝不动地贴在视口顶部附近）
    await evaluate(`(() => {
      const aside = document.querySelector("aside");
      let el = aside.parentElement;
      while (el && el !== document.body) { if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) { el.scrollTop += 500; return el.scrollTop; } el = el.parentElement; }
      return null;
    })()`);
    await sleep(600);
    const afterScroll = await evaluate(PROBE);
    await shoot(`activity-${width}`);

    const sideBySide = afterClick.detailLeft > 250;
    console.log(`\n=== ${width}px 高 ${HEIGHT} ===`);
    console.log(`  每页渲染 ${afterClick.rows} 行 · 列表面板高 ${afterClick.listPanelHeight}px`);
    console.log(sideBySide
      ? `  ✓ 并排：详情 left ${afterClick.detailLeft}（宽 ${afterClick.detailWidth ?? 380}）`
      : `  单栏：详情在列表下方，top ${afterClick.detailTop}`);
    if (!sideBySide && before.detailTop && afterClick.detailTop < before.detailTop && afterClick.detailTop < 200) {
      console.log(`  ⚠ 点击后详情被顶到视口顶部（top ${afterClick.detailTop}）`);
    } else if (!sideBySide) {
      console.log(`  点击后详情 top ${afterClick.detailTop}（视口高 ${HEIGHT}）`);
    }
    if (sideBySide) {
      // 吸顶的判据是「滚动后详情仍在视口顶部附近」，而不是「纹丝不动」：
      // sticky 相对滚动容器的 padding box 定位，页面自身还有内边距，停不到 0。
      const pinned = afterScroll.detailTop >= 0 && afterScroll.detailTop < 300;
      console.log(`  下滚 500px 后详情 top ${afterClick.detailTop} → ${afterScroll.detailTop} ${pinned ? "✓ 吸顶跟随" : "✗ 跟丢了"}`);
    }
  }
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  try { chrome?.kill(); } catch { /* ignore */ }
  try { server.kill(); } catch { /* ignore */ }
  await sleep(300);
}
