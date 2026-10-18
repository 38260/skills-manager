// Electron 桌面外壳（APP-05）：拉起本地 Node 服务，托管已构建的 dist；
// 服务退出（含应用内 restart_app）时自动重启并刷新窗口。
import { app, BrowserWindow, dialog, shell, ipcMain } from "electron";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// 打包后本地服务与前端产物位于 resources/ 下（extraResources），开发时在项目根目录。
const resourcesRoot = app.isPackaged
  ? path.join(path.dirname(app.getPath("exe")), "resources")
  : projectRoot;
const serverEntry = path.join(resourcesRoot, "backend", "server.mjs");
const preloadPath = path.join(projectRoot, "electron", "preload.cjs");
const servicePort = process.env.SKILLS_MANAGER_PORT || "14200";
const devUrl = process.env.SKILLS_MANAGER_DEV_URL;
// 应用页面地址：开发模式走 Vite，否则走本地服务托管的 dist。
const appUrl = devUrl || `http://127.0.0.1:${servicePort}`;
// 启动占位页：随窗口立刻出现，不用等服务就绪，避免「双击后一段时间毫无反馈」。
const splashPath = path.join(projectRoot, "electron", "splash.html");

let mainWindow = null;
let serverProcess = null;
let quitting = false;
// 本地服务是否已经起来过：决定新窗口直接载入应用还是先显示启动占位页。
let serviceReady = false;

function assertMainSender(event) {
  if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow?.webContents.mainFrame) {
    throw new Error("不允许的桌面调用来源");
  }
}

ipcMain.handle("desktop:open-directory", async event => {
  assertMainSender(event);
  const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
  return result.canceled ? null : result.filePaths[0] ?? null;
});
ipcMain.handle("desktop:open-skill-file", async event => {
  assertMainSender(event);
  const result = await dialog.showOpenDialog(mainWindow, { properties: ["openFile"], filters: [{ name: "Skills", extensions: ["zip", "skill"] }] });
  return result.canceled ? null : result.filePaths[0] ?? null;
});
ipcMain.handle("desktop:open-external", async (event, url) => {
  assertMainSender(event);
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) throw new Error("无效的外部链接");
  await shell.openExternal(url);
});
ipcMain.handle("desktop:confirm", async (event, message) => {
  assertMainSender(event);
  if (typeof message !== "string") throw new Error("无效的确认信息");
  const result = await dialog.showMessageBox(mainWindow, { type: "question", buttons: ["确定", "取消"], defaultId: 0, cancelId: 1, message });
  return result.response === 0;
});

function startServer() {
  if (devUrl) return; // 开发模式：Vite 已通过插件拉起本地服务
  serverProcess = spawn(process.execPath, [serverEntry, "--port", servicePort], {
    cwd: path.dirname(serverEntry),
    env: { ...process.env, SKILLS_MANAGER_ROLE: "electron-backend", ELECTRON_RUN_AS_NODE: "1" },
    stdio: "inherit",
    windowsHide: true,
  });
  serverProcess.on("exit", () => {
    serverProcess = null;
    if (!quitting) {
      // 应用内重启：服务退出后先回到占位页（此时载入应用页面只会得到连接失败），
      // 等新服务就绪再载入应用。
      serviceReady = false;
      void showSplash();
      startServer();
      whenServiceReady().then(() => { serviceReady = true; return showApp(); }).catch(() => {});
    }
  });
}

function showSplash() {
  return mainWindow?.loadFile(splashPath).catch(() => {});
}

function showApp() {
  return mainWindow?.loadURL(appUrl).catch(error => {
    console.error("[skills-manager] 载入应用页面失败：", error?.message ?? error);
  });
}

// 冷启动阶段密探（50ms）尽快接上服务，稳定后退到 150ms 减少空转；
// 总超时仍是 20s，超时按原来的方式报错退出。
function whenServiceReady(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  const probe = () => new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port: Number(servicePort), path: "/api/health", timeout: 1500 }, response => {
      response.resume();
      response.statusCode === 200 ? resolve() : retry();
    });
    request.on("error", retry);
    request.on("timeout", () => { request.destroy(); retry(); });
    function retry() {
      if (Date.now() > deadline) { reject(new Error("本地服务未就绪")); return; }
      setTimeout(() => probe().then(resolve, reject), ++attempts < 40 ? 50 : 150);
    }
  });
  return probe();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 960, minHeight: 640,
    autoHideMenuBar: true,
    backgroundColor: "#0d0d0f",
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  // 兜底：占位页万一读不出来，也要把窗口显示出来——「双击没反应」比慢更糟。
  const showFallback = setTimeout(() => mainWindow?.show(), 3000);
  // 首帧就绪再显示，避免先闪一下空窗口；占位页是本地文件，几乎是立刻。
  mainWindow.once("ready-to-show", () => { clearTimeout(showFallback); mainWindow?.show(); });
  // 服务还没起来（冷启动）先给占位页；已经就绪（关窗后重新打开）直接进应用。
  if (serviceReady) void showApp();
  else void showSplash();
  mainWindow.on("closed", () => { clearTimeout(showFallback); mainWindow = null; });
}

app.whenReady().then(async () => {
  startServer();
  // 先建窗口：Electron 冷启动 + 本地服务起来的这段时间用户就能看到占位页，
  // 而不是一片空白；服务就绪后把窗口里的占位页换成真正的应用。
  createWindow();
  try { await whenServiceReady(); }
  catch (error) {
    dialog.showErrorBox("Skills Manager", `本地服务启动失败：${error.message}`);
    app.quit();
    return;
  }
  serviceReady = true;
  await showApp();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("before-quit", () => { quitting = true; });
app.on("window-all-closed", () => {
  quitting = true;
  if (serverProcess) { try { serverProcess.kill(); } catch {} }
  app.quit();
});
