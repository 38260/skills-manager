/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { listen } from "../lib/transport";
import * as api from "../lib/tauri";
import type { GitPreviewResult } from "../lib/tauri";
import { getErrorMessage, getErrorKind } from "../lib/error";
import { useApp } from "./AppContext";

/** 后端 install-progress 事件负载（见 backend/server.mjs 的 gitHooks）。 */
export interface InstallProgressEvent {
  skill_id: string;
  phase: string;
  /** git 原始进度行，仅克隆阶段有。 */
  detail?: string | null;
  /** 克隆百分比，解析自进度行；非进度行为 null。 */
  percent?: number | null;
  /** 逐项安装的序号与总数，仅安装阶段有。 */
  index?: number;
  total?: number;
  name?: string | null;
}

/** 侧边栏常驻进度条渲染所需的最小状态。 */
export interface InstallTask {
  /** 与后端广播的 skill_id 对齐；只有匹配的事件才会更新这个任务。 */
  key: string;
  label: string;
  phase: string;
  percent: number | null;
  detail: string | null;
  index: number | null;
  total: number | null;
  itemName: string | null;
}

export interface GitSelection {
  rel_path: string;
  name: string;
  description: string | null;
  selected: boolean;
}

interface InstallTaskContextValue {
  /** 进行中的安装任务；null 表示空闲（此时若有预览则显示"待确认"）。 */
  task: InstallTask | null;
  dismissTask: () => void;
  /** git 安装会话：放在 Context 里，切换视图后预览与选择不会丢失。 */
  gitUrl: string;
  setGitUrl: (value: string) => void;
  /** 已预览成功、等待确认的仓库地址；确认安装时回传给后端作为取消/进度键。 */
  gitRepoUrl: string | null;
  gitPreview: GitPreviewResult | null;
  gitSelections: GitSelection[];
  gitLoading: boolean;
  gitConfirmLoading: boolean;
  gitError: string | null;
  startGitPreview: () => Promise<void>;
  closeGitPreview: () => void;
  toggleGitSelection: (relPath: string) => void;
  setAllGitSelections: (selected: boolean) => void;
  renameGitSelection: (relPath: string, name: string) => void;
  confirmGitInstall: () => Promise<void>;
}

const InstallTaskContext = createContext<InstallTaskContextValue | null>(null);

/** 安装完成后的停留时间：让进度条展示"已完成"而不是瞬间消失。 */
const DONE_LINGER_MS = 1200;

export function InstallTaskProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { refreshPresets, refreshManagedSkills } = useApp();
  const [task, setTask] = useState<InstallTask | null>(null);
  const [gitUrl, setGitUrl] = useState("");
  const [gitRepoUrl, setGitRepoUrl] = useState<string | null>(null);
  const [gitPreview, setGitPreview] = useState<GitPreviewResult | null>(null);
  const [gitSelections, setGitSelections] = useState<GitSelection[]>([]);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitConfirmLoading, setGitConfirmLoading] = useState(false);
  const [gitError, setGitError] = useState<string | null>(null);
  const doneTimer = useRef<number | null>(null);

  const cancelDoneTimer = useCallback(() => {
    if (doneTimer.current !== null) { window.clearTimeout(doneTimer.current); doneTimer.current = null; }
  }, []);

  const dismissTask = useCallback(() => { cancelDoneTimer(); setTask(null); }, [cancelDoneTimer]);

  // 全局监听安装进度：监听器挂在 Provider 上而不是安装页组件内，
  // 因此切到其他视图（安装页卸载）后进度依然持续更新，不会被"打断"。
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<InstallProgressEvent>("install-progress", (event) => {
      if (disposed) return;
      const payload = event.payload;
      setTask((current) => {
        // 只认领当前任务的进度：技能"更新"也用同一事件（key 为 update:<id>），不应混入安装条。
        if (!current || current.key !== payload.skill_id) return current;
        if (payload.phase === "done") {
          cancelDoneTimer();
          doneTimer.current = window.setTimeout(() => setTask(null), DONE_LINGER_MS);
          return { ...current, phase: "done", percent: 100 };
        }
        return {
          ...current,
          phase: payload.phase,
          // percent 为 null 表示这一行不是进度行，保留上一次的百分比而不是回退到 0。
          percent: payload.percent ?? current.percent,
          detail: payload.detail?.trim() ? payload.detail.trim() : current.detail,
          index: payload.index ?? current.index,
          total: payload.total ?? current.total,
          itemName: payload.name ?? current.itemName,
        };
      });
    }).then((stop) => { if (disposed) stop(); else unlisten = stop; });
    return () => { disposed = true; unlisten?.(); };
  }, [cancelDoneTimer]);

  useEffect(() => () => cancelDoneTimer(), [cancelDoneTimer]);

  const startGitPreview = useCallback(async () => {
    const url = gitUrl.trim();
    if (!url) return;
    setGitLoading(true);
    setGitError(null);
    setTask({ key: url, label: url, phase: "cloning", percent: null, detail: null, index: null, total: null, itemName: null });
    try {
      const preview = await api.previewGitInstall(url);
      setGitPreview(preview);
      setGitRepoUrl(url);
      setGitSelections(preview.skills.map((skill) => ({
        rel_path: skill.rel_path,
        name: skill.name,
        description: skill.description,
        selected: true,
      })));
      // 克隆结束，交给用户在预览里挑技能；此时进度条切换为"待确认"。
      dismissTask();
    } catch (error) {
      const message = getErrorMessage(error, t("common.error"));
      setGitError(message);
      if (getErrorKind(error) === "cancelled") toast.info(t("install.toast.cancelled"));
      else toast.error(message);
      dismissTask();
    } finally {
      setGitLoading(false);
    }
  }, [gitUrl, t, dismissTask]);

  const closeGitPreview = useCallback(() => {
    if (gitConfirmLoading) return;
    if (gitPreview) api.cancelGitPreview(gitPreview.temp_dir).catch(() => { /* 预览已失效时忽略 */ });
    setGitPreview(null);
    setGitRepoUrl(null);
    setGitSelections([]);
  }, [gitPreview, gitConfirmLoading]);

  const toggleGitSelection = useCallback((relPath: string) => {
    setGitSelections((prev) => prev.map((item) => item.rel_path === relPath ? { ...item, selected: !item.selected } : item));
  }, []);

  const setAllGitSelections = useCallback((selected: boolean) => {
    setGitSelections((prev) => prev.map((item) => ({ ...item, selected })));
  }, []);

  const renameGitSelection = useCallback((relPath: string, name: string) => {
    setGitSelections((prev) => prev.map((item) => item.rel_path === relPath ? { ...item, name } : item));
  }, []);

  const confirmGitInstall = useCallback(async () => {
    if (!gitPreview) return;
    const repoUrl = gitRepoUrl ?? gitUrl.trim();
    if (!repoUrl) return;
    const selected = gitSelections.filter((item) => item.selected);
    if (selected.length === 0) return;
    setGitConfirmLoading(true);
    setTask({ key: repoUrl, label: repoUrl, phase: "installing", percent: null, detail: null, index: null, total: selected.length, itemName: null });
    try {
      await api.confirmGitInstall(repoUrl, gitPreview.temp_dir, selected.map((item) => ({ rel_path: item.rel_path, name: item.name })));
      await Promise.all([refreshPresets(), refreshManagedSkills()]);
      toast.success(t("install.toast.success", { name: selected.map((item) => item.name).join(", ") }));
      setGitPreview(null);
      setGitRepoUrl(null);
      setGitSelections([]);
      setGitUrl("");
      // 后端会补一条 phase:"done"，进度条由它负责收尾；这里不再手动清除。
    } catch (error) {
      if (getErrorKind(error) === "cancelled") toast.info(t("install.toast.cancelled"));
      else toast.error(getErrorMessage(error, t("common.error")));
      dismissTask();
    } finally {
      setGitConfirmLoading(false);
    }
  }, [gitPreview, gitRepoUrl, gitUrl, gitSelections, refreshPresets, refreshManagedSkills, t, dismissTask]);

  const value: InstallTaskContextValue = {
    task, dismissTask,
    gitUrl, setGitUrl, gitRepoUrl, gitPreview, gitSelections,
    gitLoading, gitConfirmLoading, gitError,
    startGitPreview, closeGitPreview,
    toggleGitSelection, setAllGitSelections, renameGitSelection,
    confirmGitInstall,
  };

  return <InstallTaskContext.Provider value={value}>{children}</InstallTaskContext.Provider>;
}

export function useInstallTask() {
  const context = useContext(InstallTaskContext);
  if (!context) throw new Error("useInstallTask 必须在 InstallTaskProvider 内使用");
  return context;
}
