// 真实数据下的配色证据：隔离夹具（库 DB 副本 + junction 挂载真实 Agent 目录）+ 无头 Chrome，
// 在浅色主题下逐页截图，并统计「中性灰像素占比 / 平均饱和度」把「发灰」量化。
// 用法：node output/ui-contrast/shot-real.mjs [tag]
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

const tag = process.argv[2] ?? "real";
const REAL = path.join(os.homedir(), ".skills-manager");
const REAL_HOME = os.homedir();
const root = path.resolve("output/ui-contrast");
const runTag = new Date().toISOString().replace(/[:.]/g, "-");
const home = path.join(root, "data", `real-${runTag}`);
const dir = path.join(home, ".skills-manager");
const evidence = path.join(root, "evidence", tag);
fs.mkdirSync(evidence, { recursive: true });
fs.mkdirSync(dir, { recursive: true });

for (const name of ["skills-manager.db", "skills-manager.db-wal", "skills-manager.db-shm", ".secret.key", "repo-config.json"]) {
  if (fs.existsSync(path.join(REAL, name))) fs.cpSync(path.join(REAL, name), path.join(dir, name));
}
fs.mkdirSync(path.join(dir, "skills"), { recursive: true });
fs.cpSync(path.join(REAL, "skills", ".skills-manager"), path.join(dir, "skills", ".skills-manager"), { recursive: true });
if (fs.existsSync(path.join(REAL, "install-manifests"))) fs.cpSync(path.join(REAL, "install-manifests"), path.join(dir, "install-manifests"), { recursive: true });

const agents = JSON.parse(fs.readFileSync(path.resolve("backend/agents.json"), "utf8"));
for (const relative of [...new Set(agents.map(item => item.relative_detect_dir).filter(Boolean))]) {
  const target = path.join(REAL_HOME, relative);
  const link = path.join(home, relative);
  if (!fs.existsSync(target) || fs.existsSync(link)) continue;
  try { fs.symlinkSync(target, link, "junction"); } catch { /* 跳过 */ }
}
fs.mkdirSync(path.join(home, ".skills-manager-activity"), { recursive: true });
fs.cpSync(path.join(REAL_HOME, ".skills-manager-activity"), path.join(home, ".skills-manager-activity"), { recursive: true });

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
const profile = fs.mkdtempSync(path.join(process.env.TEMP ?? "/tmp", "ui-color-profile-"));
const server = spawn(process.execPath, ["backend/server.mjs", "--port", String(port), "--directory", dir, "--home", home],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let log = "";
server.stdout.on("data", chunk => { log += chunk; });
server.stderr.on("data", chunk => { log += chunk; });

// 统计像素：中性灰占比、平均饱和度、出现最多的颜色（用于判断「整屏是不是灰的」）
const PIXEL_STATS = `
  (async () => {
    const canvas = document.createElement('canvas');
    const image = new Image();
    return 'skip';
  })()
`;

let chrome, ws;
const report = {};
try {
  const deadline = Date.now() + 20000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* 等 */ }
    if (Date.now() > deadline) throw new Error(`服务未就绪：${log}`);
    await sleep(150);
  }
  chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*", `--user-data-dir=${profile}`,
    "--window-size=1600,1000"], { stdio: "ignore" });
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
    const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1600, height: 1000, scale: 1 } });
    fs.writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(shot.data, "base64"));
    return shot.data;
  };

  await send("Page.enable");
  await send("Runtime.enable");

  const routes = [["/", "workbench"], ["/my-skills", "library"], ["/skill-activity", "activity"], ["/global-workspace", "workspace"], ["/settings", "settings"]];
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
  await sleep(2500);
  await evaluate(`localStorage.setItem('theme','light')`);

  for (const [route, name] of routes) {
    await send("Page.navigate", { url: `http://127.0.0.1:${port}${route}` });
    await sleep(2600);
    const data = await shoot(`${name}-light`);
    // 用 CDP 直接把截图交给浏览器解码统计（避免引入图像库）
    const stats = await evaluate(`(async () => {
      const base64 = ${JSON.stringify(data)};
      const image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = 'data:image/png;base64,' + base64; });
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const { data: px } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let total = 0, neutral = 0, satSum = 0, lightSum = 0;
      const buckets = new Map();
      for (let i = 0; i < px.length; i += 4 * 7) {   // 每 7 个像素采一次，够用且快
        const r = px[i], g = px[i + 1], b = px[i + 2];
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const sat = max === 0 ? 0 : (max - min) / max;
        total++; satSum += sat;
        if (sat < 0.06) neutral++;                    // 中性灰：饱和度 < 6%
        lightSum += (r + g + b) / 3;
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
      const top = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([key, count]) => {
        const r = ((key >> 10) & 31) << 3, g = ((key >> 5) & 31) << 3, b = (key & 31) << 3;
        return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('') + '×' + (count / total * 100).toFixed(1) + '%';
      });
      return {
        像素总数: total,
        中性灰占比: Math.round(neutral / total * 1000) / 10 + '%',
        平均饱和度: Math.round(satSum / total * 1000) / 1000,
        平均亮度: Math.round(lightSum / total),
        主要颜色: top,
      };
    })()`, true);
    report[name] = stats;
    console.log(`\n[${name}] ${route}`);
    console.log(JSON.stringify(stats, null, 1));
  }
  // 打开第一个技能的详情（用户说的「技能里」很可能就是这里），截一张
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/my-skills` });
  await sleep(2600);
  const opened = await evaluate(`(() => { const card = document.querySelector('.app-panel'); if (!card) return 'no-card'; card.click(); return 'clicked'; })()`);
  await sleep(6500);
  const detail = await shoot("detail-light");
  report.detail = { opened, heading: await evaluate(`document.querySelector('h1,h2')?.textContent ?? null`) };
  console.log(`\n[detail] 点击结果 ${opened}，页头「${report.detail.heading}」`);
  const detailStats = await evaluate(`(async () => {
    const base64 = ${JSON.stringify(detail)};
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = 'data:image/png;base64,' + base64; });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const { data: px } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let total = 0, neutral = 0, satSum = 0;
    for (let i = 0; i < px.length; i += 4 * 7) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      total++; satSum += max === 0 ? 0 : (max - min) / max;
      if (max === 0 ? true : (max - min) / max < 0.06) neutral++;
    }
    return { 中性灰占比: Math.round(neutral / total * 1000) / 10 + '%', 平均饱和度: Math.round(satSum / total * 1000) / 1000 };
  })()`, true);
  report.detail = { ...report.detail, ...detailStats };
  console.log(JSON.stringify(detailStats));
  fs.writeFileSync(path.join(evidence, "pixel-stats.json"), JSON.stringify(report, null, 2));
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  try { chrome?.kill(); } catch { /* ignore */ }
  try { server.kill(); } catch { /* ignore */ }
  await sleep(300);
}
