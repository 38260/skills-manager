// 桌面能力适配层：Tauri（原生 IPC）、Electron（preload 桥）、纯浏览器三种环境统一行为。
import { isTauri } from "./transport";
import { getDesktopCapabilities } from "./desktopCapabilities";

interface DesktopBridge {
  openDirectory: () => Promise<string | null>;
  openSkillFile: () => Promise<string | null>;
  openExternal: (url: string) => Promise<void>;
  confirm: (message: string) => Promise<boolean>;
}

function bridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { __desktopBridge__?: DesktopBridge }).__desktopBridge__ ?? null;
}

export const desktopCapabilities = getDesktopCapabilities(
  isTauri ? "tauri" : bridge() ? "electron" : "browser",
  typeof navigator === "undefined" ? "" : navigator.userAgent,
);

/**
 * 选择一个目录；取消返回 null。options 兼容 Tauri plugin-dialog 的调用形状（当前仅支持目录选择）。
 * 纯浏览器环境抛错，由调用方提示手动输入路径。
 */
export async function openDirectory(options?: { directory?: boolean; multiple?: boolean }): Promise<string | null> {
  if (options && options.directory === false) throw new Error("仅支持目录选择");
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    return (await open({ directory: true, multiple: false })) as string | null;
  }
  const desktop = bridge();
  if (desktop) return desktop.openDirectory();
  throw new Error("当前环境不支持目录选择，请手动输入路径");
}

/** 选择已有安装入口支持的 .zip 或 .skill 文件；取消返回 null。 */
export async function openSkillFile(): Promise<string | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    return (await open({ multiple: false, filters: [{ name: "Skills", extensions: ["zip", "skill"] }] })) as string | null;
  }
  const desktop = bridge();
  if (desktop) return desktop.openSkillFile();
  throw new Error("当前环境不支持文件选择，请使用桌面应用");
}

/** 用系统默认方式打开外部链接；浏览器环境回退为新标签页。 */
export async function openExternal(url: string): Promise<void> {
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  const desktop = bridge();
  if (desktop) { await desktop.openExternal(url); return; }
  window.open(url, "_blank", "noopener");
}

/** 原生确认框；浏览器环境回退为 window.confirm。 */
export async function confirmDialog(message: string): Promise<boolean> {
  if (isTauri) {
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    return confirm(message);
  }
  const desktop = bridge();
  if (desktop) return desktop.confirm(message);
  return window.confirm(message);
}
