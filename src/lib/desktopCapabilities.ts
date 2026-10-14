export type DesktopRuntime = "tauri" | "electron" | "browser";

/** 能力随实际宿主提供，避免仅按操作系统显示无法生效的设置。 */
export function getDesktopCapabilities(runtime: DesktopRuntime, userAgent: string) {
  const native = runtime === "tauri";
  return {
    runtime,
    tray: native,
    closeAction: native,
    proxy: native,
    skillUpdateSchedule: native,
    installAppUpdate: native && /Windows|Mac/.test(userAgent),
  };
}
