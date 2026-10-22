import { useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import i18n from "../i18n";
import {
  LOCAL_DISCOVERY_NOTIFIED_SETTING,
  mergeNotifiedKeys,
  newPendingGroups,
  parseNotifiedKeys,
  pendingGroups,
} from "../lib/localDiscovery";
import * as api from "../lib/tauri";
import type { ScanResult } from "../lib/tauri";

const DISCOVERY_TOAST_ID = "local-skill-discovery";

export function useLocalDiscoveryNotifications() {
  const navigate = useNavigate();
  const notifiedRef = useRef<Set<string> | null>(null);
  const notifiedLoadedRef = useRef(false);

  return useCallback(async (result: ScanResult) => {
    let firstSuccessfulScan = false;
    if (!notifiedLoadedRef.current) {
      let raw: string | null = null;
      try { raw = await api.getSettings(LOCAL_DISCOVERY_NOTIFIED_SETTING); }
      catch (error) { console.warn("读取本地发现去重状态失败:", error); }
      const parsed = parseNotifiedKeys(raw);
      firstSuccessfulScan = parsed === null;
      notifiedRef.current = parsed ?? new Set();
      notifiedLoadedRef.current = true;
    }

    const notified = notifiedRef.current ?? new Set<string>();
    const fresh = firstSuccessfulScan
      ? pendingGroups(result.groups)
      : newPendingGroups(result.groups, notified);
    const next = mergeNotifiedKeys(notified, result.groups);
    notifiedRef.current = next;
    if (next.size !== notified.size) {
      try {
        await api.setSettings(LOCAL_DISCOVERY_NOTIFIED_SETTING, JSON.stringify([...next]));
      } catch (error) {
        console.warn("保存本地发现去重状态失败:", error);
      }
    }

    const onLocalPage = window.location.pathname === "/install"
      && new URLSearchParams(window.location.search).get("tab") === "local";
    if (fresh.length === 0 || onLocalPage) return;
    toast.info(i18n.t("install.discovery.notify", { count: fresh.length }), {
      id: DISCOVERY_TOAST_ID,
      duration: 10000,
      action: {
        label: i18n.t("install.discovery.view"),
        onClick: () => navigate("/install?tab=local"),
      },
    });
  }, [navigate]);
}
