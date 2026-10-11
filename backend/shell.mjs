import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { zipSync } from "fflate";
import { redact } from "./files.mjs";

// 桌面外壳与诊断命令（APP-05）：浏览器/桌面模式下替代 Tauri 外壳能力。
// 应用内更新检查采用保守策略：仅当配置了 update_manifest_url 时联网检查，否则报告当前版本无更新。
export function shellCommands(store, { packageVersion, exit, restart }) {
  const logsDir = () => path.join(store.directory, "logs");
  const panicFile = () => path.join(logsDir(), "panic.json");

  function readPackageVersion() {
    try {
      return JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version ?? "unknown";
    } catch { return "unknown"; }
  }

  return {
    app_exit: { call: () => { exit?.(); } },
    hide_to_tray: { call: () => { /* 浏览器/服务模式没有托盘，保持无操作 */ } },
    restart_app: { call: () => { restart?.(); } },
    update_install_blocker: { call: () => null },
    check_app_update: { call: async () => {
      const current = packageVersion ?? readPackageVersion();
      const manifestUrl = store.getSetting("update_manifest_url");
      if (!manifestUrl) return { has_update: false, current_version: current, latest_version: current, release_url: null };
      try {
        const response = await fetch(manifestUrl, { signal: AbortSignal.timeout(15000) });
        const manifest = await response.json();
        const latest = String(manifest.version ?? current);
        return { has_update: latest !== current, current_version: current, latest_version: latest, release_url: manifest.release_url ?? null };
      } catch (error) {
        throw new Error(`更新检查失败：${redact(error.message)}`);
      }
    } },
    get_diagnostic_info: { call: () => ({
      app_version: packageVersion ?? readPackageVersion(),
      os: process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux",
      os_version: os.release(), arch: process.arch,
      central_repo_path: store.directory,
      central_repo_path_overridden: !!store.repoPathOverride,
    }) },
    get_recent_log_excerpt: { call: () => {
      const logPath = path.join(logsDir(), "server.log");
      let content = "";
      try { content = fs.readFileSync(logPath, "utf8"); } catch {}
      const lines = content.split(/\r?\n/).filter(line => line.length);
      const excerpt = lines.slice(-200).join("\n");
      return { log_path: logPath, excerpt, line_count: lines.length, has_warnings: lines.slice(-200).some(line => /\[error\]|\[warn\]/i.test(line)) };
    } },
    export_logs_zip: { call: () => {
      const dir = logsDir();
      if (!fs.existsSync(dir)) throw new Error("没有可导出的日志");
      const entries = {};
      let fileCount = 0;
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (!fs.statSync(full).isFile()) continue;
        entries[name] = new Uint8Array(fs.readFileSync(full));
        fileCount++;
      }
      if (!fileCount) throw new Error("没有可导出的日志");
      const zipPath = path.join(store.directory, "cache", `logs-${Date.now()}.zip`);
      fs.mkdirSync(path.dirname(zipPath), { recursive: true });
      fs.writeFileSync(zipPath, zipSync(entries));
      return { zip_path: zipPath, file_count: fileCount };
    } },
    check_last_panic: { call: () => {
      try { return JSON.parse(fs.readFileSync(panicFile(), "utf8")); } catch { return null; }
    } },
    clear_last_panic: { call: () => { try { fs.unlinkSync(panicFile()); } catch {} } },
  };
}

// 诊断日志：把 console 输出同步写入 <技能库>/logs/server.log；未捕获异常写入 panic.json 供下次启动展示。
export function attachDiagnostics(store) {
  const dir = path.join(store.directory, "logs");
  fs.mkdirSync(dir, { recursive: true });
  const logPath = path.join(dir, "server.log");
  const stream = fs.createWriteStream(logPath, { flags: "a" });
  const write = level => (...args) => {
    const line = `${new Date().toISOString()} [${level}] ${args.map(arg => typeof arg === "string" ? arg : JSON.stringify(arg)).join(" ")}\n`;
    try { stream.write(line); } catch { /* 日志写入失败不影响服务 */ }
  };
  const original = { log: console.log, error: console.error, warn: console.warn };
  console.log = (...args) => { original.log(...args); write("info")(...args); };
  console.error = (...args) => { original.error(...args); write("error")(...args); };
  console.warn = (...args) => { original.warn(...args); write("warn")(...args); };
  process.on("uncaughtException", error => {
    try {
      fs.writeFileSync(path.join(dir, "panic.json"), JSON.stringify({ timestamp: new Date().toISOString(), message: redact(error.stack || error.message) }));
    } catch {}
    original.error("[panic]", error.stack || String(error));
    process.exit(1);
  });
  return { logPath, close: () => { try { stream.end(); } catch {} } };
}
