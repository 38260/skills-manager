import { useCallback, type MouseEventHandler } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../lib/transport";

/**
 * Returns a mousedown handler that initiates window dragging via Tauri API.
 */
export function useDragWindow(): MouseEventHandler {
  return useCallback((e) => {
    // 浏览器模式没有可拖动的窗口边框
    if (!isTauri) return;
    if (e.buttons === 1 && e.detail === 1) {
      getCurrentWindow().startDragging();
    }
  }, []);
}
