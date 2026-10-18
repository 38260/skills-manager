// 前端与本地服务的通信层：桌面（Tauri）环境沿用原生 IPC，浏览器环境走本地 HTTP 服务。
// 调用、事件与错误形状在两种模式下保持一致，业务代码无感知。
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type Event, type UnlistenFn } from "@tauri-apps/api/event";
import type { ErrorKind } from "./error";

/** 桌面外壳（Tauri）内运行时为 true；纯浏览器环境直接访问本地服务。 */
export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 本地服务返回的结构化错误负载（见 backend/server.mjs）。 */
interface ServiceError {
  ok: false;
  code: string;
  kind?: ErrorKind;
  message: string;
}

async function invokeOverHttp<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/invoke/${command}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-skills-manager-client": "webview",
      },
      body: JSON.stringify(args ?? {}),
    });
  } catch {
    throw new Error("无法连接本地服务，请确认 Skills Manager 服务已启动");
  }
  let payload: { ok: true; data: T } | ServiceError | null;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`本地服务响应无效（${command}）`);
  }
  if (payload && payload.ok) return payload.data;
  const error = new Error(payload?.message ?? `本地服务调用失败（${command}）`);
  if (payload && !payload.ok) {
    Object.assign(error, { code: payload.code, kind: payload.kind });
  }
  throw error;
}

export async function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (isTauri) return tauriInvoke<T>(command, args);
  return invokeOverHttp<T>(command, args);
}

// ── 事件通知：桌面用 Tauri 事件；浏览器用 SSE，事件名与负载形状保持一致 ──

let eventSource: EventSource | null = null;
const sseHandlers = new Map<string, Set<(message: MessageEvent) => void>>();

function ensureEventSource() {
  if (eventSource) return;
  // EventSource 断线后自动重连；中断期间的事件不补发。
  eventSource = new EventSource("/api/events");
}

export async function listen<T>(
  event: string,
  handler: (event: Event<T>) => void,
): Promise<UnlistenFn> {
  if (isTauri) return tauriListen<T>(event, handler);
  ensureEventSource();
  const wrapped = (message: MessageEvent) => {
    let payload: unknown = null;
    if (typeof message.data === "string" && message.data.length > 0) {
      try {
        payload = JSON.parse(message.data);
      } catch {
        payload = message.data;
      }
    }
    handler({ event, id: -1, payload: payload as T });
  };
  let handlers = sseHandlers.get(event);
  if (!handlers) {
    handlers = new Set();
    sseHandlers.set(event, handlers);
  }
  handlers.add(wrapped);
  eventSource!.addEventListener(event, wrapped as EventListener);
  return async () => {
    handlers!.delete(wrapped);
    eventSource?.removeEventListener(event, wrapped as EventListener);
    if (handlers!.size === 0) {
      sseHandlers.delete(event);
      if (sseHandlers.size === 0) {
        eventSource?.close();
        eventSource = null;
      }
    }
  };
}
