import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { zipSync } from "fflate";
import { redact, inside } from "./files.mjs";

// 判断路径是否位于允许的根目录之内（含根目录本身）；用于限制"打开文件"的作用范围。
export function pathWithinRoots(target, roots) {
  const resolved = path.resolve(target);
  return roots.filter(Boolean).some(root => {
    const relative = path.relative(path.resolve(root), resolved);
    return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
  });
}

// 桌面外壳与诊断命令（APP-05）：浏览器/桌面模式下替代 Tauri 外壳能力。
// 应用内更新检查采用保守策略：仅当配置了 update_manifest_url 时联网检查，否则报告当前版本无更新。
export function shellCommands(store, { packageVersion, exit, restart, extraRoots = () => [] }) {
  const logsDir = () => path.join(store.directory, "logs");
  const panicFile = () => path.join(logsDir(), "panic.json");

  function readPackageVersion() {
    try {
      return JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version ?? "unknown";
    } catch { return "unknown"; }
  }

  // 打开路径的允许范围：技能库目录、已纳管技能的中心库与本地来源目录，以及调用记录来源目录。
  function allowedRoots() {
    const roots = [store.directory];
    for (const skill of store.skills()) {
      roots.push(skill.central_path);
      const source = skill.source_ref_resolved || skill.source_ref;
      if (source && !/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) roots.push(source);
    }
    roots.push(...(extraRoots() ?? []));
    return roots.filter(root => typeof root === "string" && root && fs.existsSync(root));
  }

  // 仅允许打开白名单目录内的路径，避免渲染进程用任意路径调用系统程序。
  function resolveOpenTarget(target) {
    const resolved = path.resolve(String(target ?? ""));
    if (!target || !fs.existsSync(resolved)) throw new Error("目标文件不存在或已被移动");
    if (!pathWithinRoots(resolved, allowedRoots())) throw new Error("该路径不在允许打开的目录内");
    return resolved;
  }

  function launch(target, reveal) {
    const options = { detached: true, stdio: "ignore" };
    let child;
    if (process.platform === "win32") {
      child = reveal
        ? spawn("explorer.exe", [`/select,${target}`], options)
        : spawn("rundll32.exe", ["url.dll,FileProtocolHandler", target], { ...options, windowsHide: true });
    } else if (process.platform === "darwin") {
      child = reveal ? spawn("open", ["-R", target], options) : spawn("open", [target], options);
    } else {
      child = spawn("xdg-open", [reveal ? path.dirname(target) : target], options);
    }
    child.on("error", () => { /* 系统没有对应打开方式时静默失败，前端保留路径可手动复制。 */ });
    child.unref();
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

    // 用系统默认程序打开文件/目录；reveal 为 true 时在文件管理器中定位该文件。
    // 传入 skillId 时按技能中心库副本内的相对路径解析，避免前端拼接绝对路径。
    open_path: { call: args => {
      const target = args.skillId
        ? inside(store.skill(String(args.skillId)).central_path, String(args.relative ?? ""))
        : resolveOpenTarget(args.path);
      if (!fs.existsSync(target)) throw new Error("目标文件不存在或已被移动");
      const reveal = Boolean(args.reveal);
      launch(target, reveal);
      return { path: target, reveal };
    } },
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
