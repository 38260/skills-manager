// Electron 桌面外壳（APP-05）：拉起本地 Node 服务，托管已构建的 dist；
// 服务退出（含应用内 restart_app）时自动重启并刷新窗口。
import { app, BrowserWindow, dialog, shell } from "electron";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverEntry = path.join(projectRoot, "backend", "server.mjs");
const servicePort = process.env.SKILLS_MANAGER_PORT || "14200";
const devUrl = process.env.SKILLS_MANAGER_DEV_URL;

let mainWindow = null;
let serverProcess = null;
let quitting = false;

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
      // 应用内重启：服务退出后重新拉起并刷新页面
      startServer();
      whenServiceReady().then(() => mainWindow?.webContents.reload()).catch(() => {});
    }
  });
}

function whenServiceReady(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  const probe = () => new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port: Number(servicePort), path: "/api/health", timeout: 1500 }, response => {
      response.resume();
      response.statusCode === 200 ? resolve() : retry();
    });
    request.on("error", retry);
    request.on("timeout", () => { request.destroy(); retry(); });
    function retry() { Date.now() > deadline ? reject(new Error("本地服务未就绪")) : setTimeout(() => probe().then(resolve, reject), 300); }
  });
  return probe();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 960, minHeight: 640,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(projectRoot, "electron", "preload.cjs"),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  if (devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(projectRoot, "dist", "index.html"));
  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  startServer();
  try { await whenServiceReady(); }
  catch (error) {
    dialog.showErrorBox("Skills Manager", `本地服务启动失败：${error.message}`);
    app.quit();
    return;
  }
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("before-quit", () => { quitting = true; });
app.on("window-all-closed", () => {
  quitting = true;
  if (serverProcess) { try { serverProcess.kill(); } catch {} }
  app.quit();
});
