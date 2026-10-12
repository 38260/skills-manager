// 为 README 出图：用 output/readme-shots/seed-demo.mjs 生成的**纯虚构演示数据**（D:/sm-demo）
// 在浅色主题下逐页截图，写进 assets/screenshots/。
// 刻意不碰用户真实技能库与日志——README 会公开，截图里不能出现真实技能名 / 本机路径 / 调用记录。
// 用法：先 node output/readme-shots/seed-demo.mjs，再 node output/readme-shots/shoot.mjs
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

const HOME = "D:/sm-demo";
const outDir = path.resolve("assets/screenshots");
if (!fs.existsSync(path.join(HOME, ".skills-manager", "skills-manager.db"))) {
  throw new Error("演示数据不存在，请先运行 output/readme-shots/seed-demo.mjs");
}
fs.mkdirSync(outDir, { recursive: true });

// 演示库固定在浅色主题：README 出图要的是「应用默认长相」，而不是跟随本机系统设置。
{
  const { Store } = await import("../../backend/store.mjs");
  const store = new Store({ directory: path.join(HOME, ".skills-manager"), home: HOME });
  store.setSetting("theme", "light");
  store.setSetting("backup_auto_enabled", "off");
  store.close();
}

const PAGES = [
  ["/", "dashboard", 3200],
  ["/my-skills", "library", 3200],
  ["/skill-activity", "activity", 3200],
  ["/global-workspace", "workspace", 3600],
  ["/install", "install", 3600],
  ["/backup", "backup", 2600],
  ["/settings", "settings", 2600],
];

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
const profile = fs.mkdtempSync(path.join(process.env.TEMP ?? "/tmp", "readme-shots-"));
const server = spawn(process.execPath,
  ["backend/server.mjs", "--port", String(port), "--directory", path.join(HOME, ".skills-manager"), "--home", HOME],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let log = "";
server.stdout.on("data", chunk => { log += chunk; });
server.stderr.on("data", chunk => { log += chunk; });

let chrome, ws;
const written = [];
try {
  const deadline = Date.now() + 20000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* 等 */ }
    if (Date.now() > deadline) throw new Error(`服务未就绪：${log}`);
    await sleep(150);
  }
  chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--force-device-scale-factor=1", `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*",
    `--user-data-dir=${profile}`, "--window-size=1600,1000"], { stdio: "ignore" });
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
    const file = path.join(outDir, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
    console.log(`✓ ${name}.png  ${Math.round(fs.statSync(file).size / 1024)}KB`);
    written.push(name);
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });

  for (const [route, name, wait] of PAGES) {
    await send("Page.navigate", { url: `http://127.0.0.1:${port}${route}` });
    await sleep(wait);
    await shoot(name);
  }

  // 技能详情：从技能库点开第一张卡片
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/my-skills` });
  await sleep(3200);
  const clicked = await evaluate(`(() => { const card = document.querySelector('.app-panel'); if (!card) return false; card.click(); return true; })()`);
  await sleep(2500);
  const loadingText = await evaluate(`document.querySelector('.skill-detail-shell')?.textContent?.includes('加载中') ?? null`);
  await shoot("skill-detail");
  console.log(`  技能详情：点击=${clicked} 仍显示「加载中」=${loadingText}`);
  fs.writeFileSync(path.join(path.resolve("output/readme-shots"), "manifest.json"), JSON.stringify({ generatedAt: new Date().toISOString(), home: HOME, images: written }, null, 2));
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  try { chrome?.kill(); } catch { /* ignore */ }
  try { server.kill(); } catch { /* ignore */ }
  await sleep(300);
}
