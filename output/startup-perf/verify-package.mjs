// 验证打包产物（release-check/win-unpacked）自身可运行：
// 用 <Skills Manager.exe> 以 ELECTRON_RUN_AS_NODE 方式跑起随包的 backend，
// 确认 ① 瘦身后的 asar 依赖仍然完整（js-yaml / fflate 由 extraResources 提供）、
//      ② 服务能托管随包的 dist、③ 首屏占位页在随包产物里也在。
// 用法：node output/startup-perf/verify-package.mjs
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

const PACKED = path.resolve("release-check/win-unpacked");
const EXE = path.join(PACKED, "Skills Manager.exe");
if (!fs.existsSync(EXE)) throw new Error(`未找到打包产物：${EXE}`);

const REAL = path.join(os.homedir(), ".skills-manager");
const runTag = new Date().toISOString().replace(/[:.]/g, "-");
const home = path.resolve("output/startup-perf/data", `packed-${runTag}`);
const dir = path.join(home, ".skills-manager");
fs.mkdirSync(dir, { recursive: true });
fs.cpSync(REAL, dir, { recursive: true });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  probe.on("error", reject);
});

const port = await freePort();
const serverEntry = path.join(PACKED, "resources", "backend", "server.mjs");
const child = spawn(EXE, [serverEntry, "--port", String(port), "--directory", dir, "--home", home], {
  cwd: path.dirname(serverEntry),
  env: { ...process.env, SKILLS_MANAGER_ROLE: "electron-backend", ELECTRON_RUN_AS_NODE: "1" },
  stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
let log = "";
child.stdout.on("data", chunk => { log += chunk; });
child.stderr.on("data", chunk => { log += chunk; });

const failures = [];
const report = {};
try {
  const deadline = Date.now() + 30000;
  let ready = false;
  while (!ready && Date.now() < deadline) {
    try { ready = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok; } catch { /* 等 */ }
    if (!ready) await sleep(150);
  }
  report.healthOk = ready;
  if (!ready) throw new Error(`随包服务未就绪：${log}`);

  const call = async (name, params = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/invoke/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-skills-manager-client": "webview" },
      body: JSON.stringify(params),
    });
    return await response.json();
  };

  // 走一遍最吃依赖的启动命令：元数据解析要用 js-yaml。
  const skills = await call("get_managed_skills");
  report.managedSkills = { ok: skills.ok, count: Array.isArray(skills.data) ? skills.data.length : null, message: skills.message };
  if (!skills.ok) failures.push(`get_managed_skills 失败：${skills.message}`);
  if (!Array.isArray(skills.data) || skills.data.length === 0) failures.push("get_managed_skills 返回空，js-yaml 链路可能没接上");

  const tools = await call("get_tool_status");
  report.tools = { ok: tools.ok, count: Array.isArray(tools.data) ? tools.data.length : null };
  if (!tools.ok || !tools.data?.length) failures.push("get_tool_status 未返回 Agent 列表");

  const activity = await call("get_skill_activity", { page: 1, pageSize: 5 });
  report.activity = { ok: activity.ok, items: activity.data?.items?.length ?? null, message: activity.message };
  if (!activity.ok) failures.push(`get_skill_activity 失败：${activity.message}`);

  // 随包 dist：应用页面本体 + 首屏占位都要在。
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  report.indexHtmlBytes = html.length;
  report.splashInPackedHtml = html.includes('id="boot-splash"');
  report.bootThemeScript = html.includes('localStorage.getItem("theme")');
  if (!report.splashInPackedHtml) failures.push("随包 dist/index.html 缺少首屏占位");
  if (!report.bootThemeScript) failures.push("随包 dist/index.html 缺少主题脚本");

  const assetMatch = /src="(\/assets\/index-[^"]+\.js)"/.exec(html);
  if (!assetMatch) failures.push("随包 dist/index.html 未引用构建后的 JS 包");
  else {
    const asset = await fetch(`http://127.0.0.1:${port}${assetMatch[1]}`);
    report.asset = { status: asset.status, bytes: (await asset.text()).length };
    if (asset.status !== 200) failures.push(`随包静态资源不可访问：${assetMatch[1]}`);
  }

  // 随包 electron/splash.html 必须是打进 asar 的那一份。
  report.packedSplashExists = fs.existsSync(path.join(PACKED, "resources", "app.asar"));
  report.asarBytes = fs.statSync(path.join(PACKED, "resources", "app.asar")).size;

  report.ok = failures.length === 0;
  console.log(JSON.stringify({ ...report, failures }, null, 2));
  console.log(report.ok ? "\n✅ 打包产物自检通过" : `\n❌ 打包产物有问题：\n- ${failures.join("\n- ")}`);
  process.exitCode = report.ok ? 0 : 1;
} finally {
  try { child.kill(); } catch { /* ignore */ }
  await sleep(300);
}
