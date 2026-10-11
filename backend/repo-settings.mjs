import { spawn } from "node:child_process";
import os from "node:os";

// 技能库路径与设备名设置。路径修改写入待生效配置，重启后由 Store 晋升；
// 浏览器/服务模式下打开目录使用系统文件管理器。
export function repoSettingsCommands(store) {
  return {
    get_central_repo_path_override: { call: () => store.repoPathOverride },
    get_central_repo_pending_path: { call: () => store.pendingRepoPath },
    get_central_repo_warnings: { call: () => store.startupWarnings },
    set_central_repo_path: { call: args => store.setCentralRepoPath(args.path ?? null), mutating: true },
    open_central_repo_folder: { call: () => {
      const command = process.platform === "win32" ? "explorer"
        : process.platform === "darwin" ? "open" : "xdg-open";
      const child = spawn(command, [store.directory], { detached: true, stdio: "ignore", windowsHide: true });
      child.unref();
    } },

    // Git 备份设备名：清洗后保存并返回清洗结果（与旧版返回语义一致）。
    backup_device_name: { call: () => store.getSetting("backup_device_name") ?? os.hostname() },
    backup_set_device_name: { call: args => {
      const cleaned = String(args.name ?? "").trim().replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").slice(0, 64).trim();
      const saved = cleaned || "My Device";
      store.setSetting("backup_device_name", saved);
      return saved;
    }, mutating: true },
  };
}
