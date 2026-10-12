// UI 验证：安装过程中切换到其他视图，侧边栏进度条是否仍在且继续更新。
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const REPO = "file:///tmp/git-fixture";
// 必须用绝对 Windows 路径：Git Bash 的 /tmp 是 %TEMP%，而 node 的 path.resolve('/tmp/..')
// 会解析成当前盘符根目录（D:\tmp），两者不是同一个地方，会导致测试数据串台。
const BASE = path.resolve("output/install-progress-verify/data");
const DIR = `${BASE}/.skills-manager`;
const HOME = BASE;
const OUT = "output/install-progress-verify";
fs.mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => {
  const p = net.createServer();
  p.listen(0, "127.0.0.1", () => { const { port } = p.address(); p.close(() => res(port)); });
  p.on("error", rej);
});

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(c => fs.existsSync(c));
if (!CHROME) throw new Error("未找到 Chrome 或 Edge");

const results = [];
const record = (name, value) => { results.push({ name, value }); console.log(`· ${name}: ${JSON.stringify(value)}`); };

const port = await freePort();
const debugPort = await freePort();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ui-verify-"));
const server = spawn(process.execPath,
  ["backend/server.mjs", "--port", String(port), "--directory", DIR, "--home", HOME],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let log = "";
server.stdout.on("data", c => log += c);
server.stderr.on("data", c => log += c);

let chrome;
let ws;
try {
  const deadline = Date.now() + 20000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* 等启动 */ }
    if (Date.now() > deadline) throw new Error("服务未就绪: " + log);
    await sleep(150);
  }

  chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*", `--user-data-dir=${profile}`,
    "--window-size=1440,900", "about:blank"], { stdio: "ignore" });

  let target = null;
  for (let i = 0; i < 160 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      target = list.find(t => t.type === "page" && t.webSocketDebuggerUrl);
    } catch { /* 等调试端口 */ }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error("找不到可调试页面");

  ws = new WebSocket(target.webSocketDebuggerUrl);
  if (ws.readyState !== 1) await new Promise(r => ws.addEventListener("open", r, { once: true }));
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", e => {
    const m = JSON.parse(e.data);
    const entry = pending.get(m.id);
    if (entry) { pending.delete(m.id); m.error ? entry.reject(new Error(JSON.stringify(m.error))) : entry.resolve(m.result); }
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params ?? {} }));
  });
  const evaluate = async (expression, awaitPromise = false) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error(`执行失败: ${r.exceptionDetails.text}`);
    return r.result?.value;
  };
  const shoot = async name => {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(shot.data, "base64"));
    console.log(`  SHOT ${name}.png`);
  };
  const goto = async url => { await send("Page.navigate", { url }); await sleep(2000); };

  await send("Page.enable");
  await send("Runtime.enable");

  await goto(`http://127.0.0.1:${port}/install`);
  await evaluate(`localStorage.setItem('theme','light')`);
  await goto(`http://127.0.0.1:${port}/install`);

  // 全新 home 会弹出"首次运行"恢复对话框，先关掉，避免遮挡进度条截图。
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('全新开始'));
    if (btn) btn.click();
    return !!btn;
  })()`);
  await sleep(800);

  // 切到 Git 标签并填入本地仓库地址
  record("切到 Git 标签", await evaluate(`(() => {
    const tab = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Git 安装');
    if (!tab) return false;
    tab.click(); return true;
  })()`));
  await sleep(700);

  await evaluate(`(() => {
    const input = document.querySelector('input[placeholder*="github"], input[placeholder*="仓库"], input[type="text"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(REPO)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(400);

  record("点击克隆并预览", await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('克隆并预览') && !b.disabled);
    if (!btn) return false;
    btn.click(); return true;
  })()`));

  // 等预览弹窗出现
  let previewReady = false;
  for (let i = 0; i < 40 && !previewReady; i++) {
    await sleep(400);
    previewReady = await evaluate(`!!document.querySelector('input[type="checkbox"]')`);
  }
  record("预览弹窗出现", previewReady);
  record("预览技能数", await evaluate(`document.querySelectorAll('input[type="checkbox"]').length`));
  await shoot("01_git_preview");

  // 确认安装，然后立刻切走
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('导入选中项') && !b.disabled);
    if (btn) btn.click();
    return !!btn;
  })()`);
  await sleep(350);

  record("安装中侧边栏有进度条", await evaluate(`(() => {
    const aside = document.querySelector('[class*="w-[220px]"]');
    const text = aside ? aside.textContent : '';
    return { hasProgress: /正在安装|正在克隆/.test(text), text: text.replace(/\\s+/g, ' ').slice(-120) };
  })()`));
  await shoot("02_installing_on_install_page");

  // 关键断言：切到技能库后进度条仍在。
  // 必须用 SPA 链接跳转（点击侧边栏），而不是 Page.navigate —— 后者是整页重载，
  // 会重建 React 树，与"用户切视图"不是一回事。
  record("点击侧边栏「技能库」", await evaluate(`(() => {
    const link = [...document.querySelectorAll('[class*="w-[220px]"] a')].find(a => a.textContent.includes('技能库'));
    if (link) link.click();
    return !!link;
  })()`));
  await sleep(900);
  record("切到技能库后进度条仍在", await evaluate(`(() => {
    const aside = document.querySelector('[class*="w-[220px]"]');
    const text = aside ? aside.textContent : '';
    return { present: /正在安装|正在克隆|安装完成/.test(text), tail: text.replace(/\\s+/g, ' ').slice(-140) };
  })()`));
  await shoot("03_progress_on_my_skills");

  // 再切到仪表盘
  record("点击侧边栏「Dashboard」", await evaluate(`(() => {
    const link = [...document.querySelectorAll('[class*="w-[220px]"] a')].find(a => a.textContent.includes('Dashboard'));
    if (link) link.click();
    return !!link;
  })()`));
  await sleep(900);
  record("切到仪表盘后进度条仍在", await evaluate(`(() => {
    const aside = document.querySelector('[class*="w-[220px]"]');
    const text = aside ? aside.textContent : '';
    return /正在安装|正在克隆|安装完成/.test(text);
  })()`));
  await shoot("04_progress_on_dashboard");

  // 等待安装完成
  await sleep(4000);
  const installed = await evaluate(`(async () => {
    const res = await fetch('/api/invoke/get_managed_skills', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-skills-manager-client': 'webview' },
      body: '{}'
    });
    const json = await res.json();
    return json.data ? json.data.length : -1;
  })()`, true);
  record("安装完成后技能数", installed);

  record("点击侧边栏「安装 Skills」回到安装页", await evaluate(`(() => {
    const link = [...document.querySelectorAll('[class*="w-[220px]"] a')].find(a => a.textContent.includes('安装 Skills'));
    if (link) link.click();
    return !!link;
  })()`));
  await sleep(900);
  // 安装成功后会话会被主动清理，预览弹窗不再显示 —— 预期行为，不是缺陷。
  record("安装完成后预览已清理（预期）", await evaluate(`!document.querySelector('input[type="checkbox"]')`));
  await shoot("05_back_to_install");

  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(results, null, 2));
  console.log("\n结果已写入", path.join(OUT, "report.json"));
} catch (error) {
  console.error("验证中断:", error.message);
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ error: error.message, results }, null, 2));
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* 忽略 */ }
  chrome?.kill();
  server.kill();
  await sleep(400);
  fs.rmSync(profile, { recursive: true, force: true });
  process.exit(process.exitCode ?? 0);
}
