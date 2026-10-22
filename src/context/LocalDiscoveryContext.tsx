/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import i18n from "../i18n";
import { getErrorMessage } from "../lib/error";
import * as api from "../lib/tauri";
import type { ScanResult } from "../lib/tauri";
import {
  LOCAL_DISCOVERY_INTERVAL_MS,
  LocalDiscoveryCoordinator,
  type DiscoveryTrigger,
} from "../lib/localDiscovery";
import { useApp } from "./AppContext";

const STARTUP_SCAN_DELAY_MS = 1000;

export interface LocalDiscoveryScanOptions {
  /** 导入等写操作后需要新结果：等当前扫描结束后再发起，不复用旧任务。 */
  fresh?: boolean;
}

interface LocalDiscoveryState {
  scanResult: ScanResult | null;
  scanning: boolean;
  scanStatus: ScanResult["status"] | "idle";
  scanIssue: string | null;
  scan: (options?: LocalDiscoveryScanOptions) => Promise<ScanResult | null>;
}

const LocalDiscoveryContext = createContext<LocalDiscoveryState | null>(null);

function summarizeIssue(result: ScanResult): string | null {
  if (result.status === "ok") return null;
  const first = result.errors[0];
  if (!first) return result.status === "failed" ? i18n.t("install.scan.failedEmpty") : null;
  const where = first.source_path || first.path;
  const extra = result.errors.length > 1 ? `（共 ${result.errors.length} 项）` : "";
  return `${where ? `${where}：` : ""}${first.message}${extra}`;
}

export function LocalDiscoveryProvider({ children }: { children: ReactNode }) {
  const { loading } = useApp();
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<ScanResult["status"] | "idle">("idle");
  const [scanIssue, setScanIssue] = useState<string | null>(null);

  const performScan = useCallback(async (): Promise<ScanResult | null> => {
    setScanning(true);
    try {
      const result = await api.scanLocalSkills();
      setScanResult(result);
      setScanStatus(result.status);
      setScanIssue(summarizeIssue(result));
      return result;
    } catch (error: unknown) {
      setScanStatus("failed");
      setScanIssue(getErrorMessage(error, i18n.t("common.error")));
      throw error;
    } finally {
      setScanning(false);
    }
  }, []);

  const coordinator = useMemo(
    () => new LocalDiscoveryCoordinator({ run: () => performScan() }),
    [performScan]
  );

  const scan = useCallback(async (options?: LocalDiscoveryScanOptions) => {
    if (options?.fresh) await coordinator.waitForIdle();
    const request = coordinator.request("manual");
    if (!request.promise) return null;
    return await request.promise as ScanResult | null;
  }, [coordinator]);

  const startupScanRequestedRef = useRef(false);
  useEffect(() => {
    if (loading || startupScanRequestedRef.current) return;
    const timer = setTimeout(() => {
      startupScanRequestedRef.current = true;
      const request = coordinator.request("startup");
      if (request.promise) {
        void request.promise.catch(error => console.warn("启动本地扫描失败:", error));
      }
    }, STARTUP_SCAN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loading, coordinator]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const isForeground = () => document.visibilityState === "visible" && document.hasFocus();
    const runAuto = (trigger: DiscoveryTrigger) => {
      const request = coordinator.request(trigger);
      if (request.promise) {
        void request.promise.catch(error => console.warn("自动本地扫描失败:", error));
      }
    };
    const startInterval = () => {
      if (interval !== null) return;
      interval = setInterval(() => {
        // Electron 最小化时 visibilityState 可能短暂保持 visible，聚焦判定保证后台不再轮询。
        if (isForeground()) runAuto("interval");
      }, LOCAL_DISCOVERY_INTERVAL_MS);
    };
    const stopInterval = () => {
      if (interval === null) return;
      clearInterval(interval);
      interval = null;
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        if (document.hasFocus()) startInterval();
        runAuto("visibility");
      } else {
        stopInterval();
      }
    };
    const handleFocus = () => {
      if (document.visibilityState === "visible") {
        startInterval();
        runAuto("focus");
      }
    };
    const handleBlur = () => stopInterval();

    if (isForeground()) startInterval();
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    return () => {
      stopInterval();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    };
  }, [coordinator]);

  const value = useMemo<LocalDiscoveryState>(() => ({
    scanResult,
    scanning,
    scanStatus,
    scanIssue,
    scan,
  }), [scanResult, scanning, scanStatus, scanIssue, scan]);

  return (
    <LocalDiscoveryContext.Provider value={value}>
      {children}
    </LocalDiscoveryContext.Provider>
  );
}

export function useLocalDiscovery() {
  const context = useContext(LocalDiscoveryContext);
  if (!context) throw new Error("useLocalDiscovery must be used within LocalDiscoveryProvider");
  return context;
}
