import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../styles/skillLibrary.css";
import {
  Search,
  LayoutGrid,
  List,
  CheckCircle2,
  Github,
  HardDrive,
  Globe,
  Layers,
  RefreshCw,
  RotateCcw,
  GitBranch,
  ArrowUpCircle,
  Wrench,
  Loader2,
  X,
  Plus,
  SquareCheck,
  Square,
  GripVertical,
  CircleSlash,
  Circle,
  Pencil,
  Share2,
  Tag,
  Trash2,
} from "lucide-react";
import { openDirectory as dialogOpen } from "../lib/desktop";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { OperationResults, type OperationReport, type OperationItem } from "../components/OperationResults";
import { getSkillDisplayNames, matchSkillSearch, matchSnippet, type SkillSearchMatch } from "../lib/skillSearch";
import { HighlightText } from "../components/HighlightText";
import { SkillRecovery } from "../components/SkillRecovery";
import { readLibraryViewState, writeLibraryViewState, restoreLibraryScroll } from "../lib/libraryViewState";
import { sortLibrarySkills, type LibrarySortMode } from "../lib/librarySort";
import { toast } from "sonner";
import { cn } from "../utils";
import { useApp } from "../context/AppContext";
import { useMultiSelect } from "../hooks/useMultiSelect";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CreatePresetDialog } from "../components/CreatePresetDialog";
import { TagRenameDialog } from "../components/TagRenameDialog";
import { SkillDetailPanel } from "../components/SkillDetailPanel";
import { MultiSelectToolbar } from "../components/MultiSelectToolbar";
import { BatchTagDialog } from "../components/BatchTagDialog";
import { BatchSyncAgentDialog } from "../components/BatchSyncAgentDialog";
import { SyncDots } from "../components/SyncDots";
import { CardActionMenu } from "../components/CardActionMenu";
import { SkillProfileDialog } from "../components/SkillProfileDialog";
import * as api from "../lib/tauri";
import { getSkillUsage, type SkillUsage } from "../lib/activity";
import { listen } from "../lib/transport";
import { getTagActiveColor, getTagColor, pruneStaleTagFilters, UNTAGGED_FILTER } from "../lib/skillTags";
import { skillIconOption } from "../lib/presetIcons";
import type {
  ManagedSkill,
  ToolInfo,
  GitBackupStatus,
  SkillToolToggle,
} from "../lib/tauri";
import { getErrorMessage } from "../lib/error";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface SortableSkillItemProps {
  id: string;
  disabled: boolean;
  className?: string;
  /** Overrides the handle styling (grid cards render it inside the status-dot slot). */
  handleClassName?: string;
  handleTitle?: string;
  children: (dragHandle: React.ReactNode) => React.ReactNode;
}

function SortableSkillItem({
  id,
  disabled,
  className,
  handleClassName,
  handleTitle,
  children,
}: SortableSkillItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  const handle = !disabled ? (
    <div
      ref={setActivatorNodeRef}
      {...listeners}
      onClick={(e) => e.stopPropagation()}
      title={handleTitle}
      className={
        handleClassName ??
        "flex cursor-grab items-center justify-center rounded p-1 text-faint transition-colors hover:bg-surface-hover hover:text-muted active:cursor-grabbing"
      }
    >
      <GripVertical className="h-4 w-4" />
    </div>
  ) : null;

  return (
    <div ref={setNodeRef} style={style} {...attributes} className={cn("h-full", className)}>
      {children(handle)}
    </div>
  );
}

function getToolDisplayName(toolKey: string, tools: ToolInfo[]) {
  return tools.find((tool) => tool.key === toolKey)?.display_name || toolKey;
}


// 调用统计的时间：当天只显示时分，更早显示日期，避免卡片上一长串时间戳。
function formatUsageTime(value: number | null) {
  if (!value) return "—";
  const date = new Date(value);
  const pad = (input: number) => String(input).padStart(2, "0");
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? `${pad(date.getHours())}:${pad(date.getMinutes())}`
    : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// 调用统计的刷新节流：后端扫描进度通知约 250ms 一次，逐次重查会把技能库页拖烫。
const USAGE_REFRESH_THROTTLE_MS = 1200;

export function MySkills() {
  const { viewedPreset, loading } = useApp();
  const { t } = useTranslation();
  const [libraryPath, setLibraryPath] = useState<string | null>(null);
  const [pathError, setPathError] = useState("");
  const [pathRequest, setPathRequest] = useState(0);
  useEffect(() => {
    let current = true;
    api.getCentralRepoPath().then(value => { if (current) setLibraryPath(value); })
      .catch(cause => { if (current) setPathError(getErrorMessage(cause, t("common.error"))); });
    return () => { current = false; };
  }, [t, pathRequest]);
  if (!libraryPath || (loading && !viewedPreset)) return <div>
    <p role={pathError ? "alert" : "status"}>{pathError || t("common.loading")}</p>
    {pathError && <button type="button" className="app-button-secondary" onClick={() => { setPathError(""); setPathRequest(value => value + 1); }}>{t("common.retry")}</button>}
  </div>;
  return <MySkillsContent key={libraryPath + ":" + (viewedPreset?.id || "library")} libraryPath={libraryPath} presetId={viewedPreset?.id ?? null} />;
}

function MySkillsContent({ libraryPath, presetId }: { libraryPath: string; presetId: string | null }) {
  const [initialView] = useState(() => readLibraryViewState(libraryPath, presetId));
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const {
    viewedPreset,
    tools,
    managedSkills: skills,
    refreshPresets,
    refreshManagedSkills,
    refreshTools,
    detailSkillId,
    openSkillDetailById,
    closeSkillDetail,
    projects,
    refreshProjects,
  } = useApp();
  const [viewMode, setViewMode] = useState<"grid" | "list">(initialView.viewMode);
  const [sortMode, setSortMode] = useState<LibrarySortMode>(initialView.sortMode);
  const [showCreatePreset, setShowCreatePreset] = useState(false);
  const [filterMode, setFilterMode] = useState<"all" | "enabled" | "available">(initialView.filterMode);
  const [sourceFilters, setSourceFilters] = useState<Set<string>>(() => new Set(initialView.sourceFilters));
  const [tagFilters, setTagFilters] = useState<Set<string>>(() => new Set(initialView.tagFilters));
  const [profileSkillId, setProfileSkillId] = useState<string | null>(null);
  const [usage, setUsage] = useState<Record<string, SkillUsage>>({});
  const [allTags, setAllTags] = useState<string[]>([]);
  // Tag management from the filter bar (#233): right-click a tag pill to
  // rename (dialog) or delete (confirm). Left-click stays "filter only".
  const [tagMenu, setTagMenu] = useState<{ tag: string; x: number; y: number } | null>(null);
  const [tagToRename, setTagToRename] = useState<string | null>(null);
  const [tagToDelete, setTagToDelete] = useState<string | null>(null);
  const [createCategoryOpen, setCreateCategoryOpen] = useState(false);
  const [search, setSearch] = useState(initialView.search);
  const pendingScroll = useRef<number | null>(initialView.scrollTop);
  useEffect(() => {
    const container = document.getElementById("page-scroll-container");
    if (!container) return;
    return restoreLibraryScroll(container, initialView.scrollTop);
  }, [initialView]);
  useEffect(() => {
    const container = document.getElementById("page-scroll-container");
    if (!container) return;
    const save = () => {
      if (pendingScroll.current !== null && container.scrollTop === Math.min(pendingScroll.current, Math.max(0, container.scrollHeight - container.clientHeight))) pendingScroll.current = null;
      writeLibraryViewState(libraryPath, presetId, { viewMode, sortMode, filterMode, search, sourceFilters: [...sourceFilters], tagFilters: [...tagFilters], scrollTop: pendingScroll.current ?? container.scrollTop });
    };
    save();container.addEventListener("scroll", save, { passive: true });
    // 离页后的 DOM 可能已经缩短，清理时不读取它，避免把旧页面滚动位置覆盖为 0。
    return () => { container.removeEventListener("scroll", save); };
  }, [libraryPath, presetId, viewMode, sortMode, filterMode, search, sourceFilters, tagFilters]);
  const [operationReport, updateOperationReport] = useState<(OperationReport & { version: number }) | null>(null);
  function setOperationReport(report: OperationReport | null) { updateOperationReport(report ? { ...report, version: performance.now() } : null); }
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const refreshAfterDeleteRef = useRef<number | null>(null);
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false);
  const [batchTagDialogOpen, setBatchTagDialogOpen] = useState(false);
  const [batchSyncDialogOpen, setBatchSyncDialogOpen] = useState(false);
  const [batchToggling, setBatchToggling] = useState(false);
  const [checkingAll, setCheckingAll] = useState(false);
  const [checkingSkillId, setCheckingSkillId] = useState<string | null>(null);
  const [updatingSkillId, setUpdatingSkillId] = useState<string | null>(null);
  const [batchUpdating, setBatchUpdating] = useState(false);
  const [toolToggles, setToolToggles] = useState<SkillToolToggle[] | null>(null);
  const [togglingToolKey, setTogglingToolKey] = useState<string | null>(null);
  const [togglingTarget, setTogglingTarget] = useState<{ skillId: string; tool: string } | null>(null);
  const [gitStatus, setGitStatus] = useState<GitBackupStatus | null>(null);
  const [gitRemoteConfig, setGitRemoteConfig] = useState("");
  const [tagEditSkillId, setTagEditSkillId] = useState<string | null>(null);
  const [menuSkillId, setMenuSkillId] = useState<string | null>(null);
  const [skillToDelete, setSkillToDelete] = useState<ManagedSkill | null>(null);
  const [tagInput, setTagInput] = useState("");
  const tagInputRef = useRef<HTMLInputElement>(null);

  const [presetSkillOrder, setPresetSkillOrder] = useState<string[]>([]);

  const viewedPresetName = viewedPreset?.name || t("mySkills.currentPresetFallback");

  // Fetch sort order whenever active preset changes
  useEffect(() => {
    if (!viewedPreset) {
      setPresetSkillOrder([]);
      return;
    }
    api.getPresetSkillOrder(viewedPreset.id).then(setPresetSkillOrder).catch(() => {});
  }, [viewedPreset, skills]);

  // Skills with an unresolved sync conflict get a "needs attention" badge
  // that jumps to the Backup page (merge-engine design §4 UI).
  const [conflictIds, setConflictIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    api.gitBackupPendingConflicts()
      .then((rows) => setConflictIds(new Set(rows.map((row) => row.skill_id))))
      .catch(() => setConflictIds(new Set()));
  }, [skills]);

  const refreshAllTags = async () => {
    try {
      const tags = await api.getSkillCategories();
      setAllTags(tags);
    } catch {
      // not critical
    }
  };

  useEffect(() => {
    refreshAllTags();
  }, [skills]);

  // 每个技能的调用统计：技能库变化或调用记录更新时刷新；没有记录的技能按"从未使用"展示。
  const [usageRevision, setUsageRevision] = useState(0);
  useEffect(() => {
    let current = true;
    getSkillUsage()
      .then((stats) => { if (current) setUsage(stats); })
      .catch(() => { if (current) setUsage({}); });
    return () => { current = false; };
  }, [skills, usageRevision]);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // 扫描期间后端约每 250ms 推一次进度，逐次重查调用统计会让技能库页持续发烫；
    // 与调用记录页同样节流到 1.2s。
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; setUsageRevision(value => value + 1); }, USAGE_REFRESH_THROTTLE_MS);
    };
    void listen("skill-activity-changed", schedule).then(stop => {
      if (disposed) stop(); else unlisten = stop;
    }).catch(() => { /* 统计不是关键路径，事件连接失败时保持上一次结果。 */ });
    return () => { disposed = true; unlisten?.(); if (timer) clearTimeout(timer); };
  }, []);

  // Prune tag filters whose pill disappeared (e.g. its last skill was deleted),
  // otherwise a stale filter silently hides everything. An empty skill list
  // says nothing about which tags are valid, so wait for one before pruning.
  // A tag still carried by a loaded skill counts as available even when it is
  // missing from `allTags`: that list is refetched asynchronously and lags
  // `skills`, and in that window a rename would otherwise drop the filter that
  // `replaceTagInFilters` just moved onto the new name.
  useEffect(() => {
    if (skills.length === 0) return;
    const hasUntagged = true;
    const available = [...allTags, ...skills.flatMap((skill) => skill.tags)];
    setTagFilters((prev) => pruneStaleTagFilters(prev, available, hasUntagged));
  }, [allTags, skills]);

  // Close the tag context menu on Escape (click-outside is handled by its backdrop).
  useEffect(() => {
    if (!tagMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTagMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tagMenu]);

  // 筛选改为单选：同一时刻只生效一个条件（来源与分类互斥），再点一次取消。
  const applySourceFilter = (value: string) => {
    setTagFilters(new Set());
    setSourceFilters(current => (current.has(value) ? new Set() : new Set([value])));
  };
  const applyTagFilter = (value: string) => {
    setSourceFilters(new Set());
    setTagFilters(current => (current.has(value) ? new Set() : new Set([value])));
  };

  // A filter can outlive the control that set it (the tag row hides itself once
  // no tag is left), so the empty state carries the way out. `filterMode` is
  // reset too — its control never hides, but a button labelled "clear filters"
  // that leaves one of them on is a lie.
  const hasActiveFilters =
    search.trim() !== "" ||
    sourceFilters.size > 0 ||
    tagFilters.size > 0 ||
    filterMode !== "all";
  const clearFilters = () => {
    setSearch("");
    setSourceFilters(new Set());
    setTagFilters(new Set());
    setFilterMode("all");
  };

  const skillDisplayNames = useMemo(() => getSkillDisplayNames(skills), [skills]);

  // 每个技能「命中了哪个字段、命中在哪一位」：结果里据此标出命中来源，
  // 并把长描述里命中处前后的文字截出来（否则高亮常常落在被截断的后半段，看着像搜错了）。
  const searchMatches = useMemo(() => {
    const term = search.trim();
    const map = new Map<string, SkillSearchMatch>();
    if (!term) return map;
    for (const skill of skills) {
      const match = matchSkillSearch(skill, search, skillDisplayNames.get(skill.id) || skill.name);
      if (match) map.set(skill.id, match);
    }
    return map;
  }, [skills, skillDisplayNames, search]);

  const filtered = useMemo(() => {
    const result = skills.filter((skill) => {
      const displayName = skillDisplayNames.get(skill.id) || skill.name;
      if (!matchSkillSearch(skill, search, displayName)) return false;

      if (sourceFilters.size > 0 && !sourceFilters.has(skill.source_type)) return false;

      if (tagFilters.size > 0) {
        const wantUntagged = tagFilters.has(UNTAGGED_FILTER);
        const matchUntagged = wantUntagged && skill.tags.length === 0;
        const matchTag = skill.tags.some((t) => tagFilters.has(t));
        if (!matchUntagged && !matchTag) return false;
      }

      if (!viewedPreset) return true;

      const enabledInPreset = skill.preset_ids.includes(viewedPreset.id);
      if (filterMode === "enabled") return enabledInPreset;
      if (filterMode === "available") return !enabledInPreset;
      return true;
    });

    return sortLibrarySkills(result, sortMode, usage, viewedPreset?.id ?? null, presetSkillOrder);
  }, [skills, skillDisplayNames, search, sourceFilters, tagFilters, filterMode, viewedPreset, presetSkillOrder, sortMode, usage]);

  const {
    isMultiSelect, setIsMultiSelect,
    selectedIds, setSelectedIds,
    toggleSelect,
    isAllSelected,
    anyDisabled,
    handleSelectAll,
    exitMultiSelect,
  } = useMultiSelect({
    items: skills,
    filtered,
    getKey: (s) => s.id,
    isItemActive: (s) => viewedPreset ? s.preset_ids.includes(viewedPreset.id) : true,
    filterSignal: JSON.stringify([
      search,
      [...sourceFilters].sort(),
      [...tagFilters].sort(),
      filterMode,
      viewedPreset?.id ?? null,
    ]),
    escapeEnabled: !batchTagDialogOpen && !batchSyncDialogOpen && !batchDeleteConfirm,
  });

  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.id === detailSkillId) || null,
    [detailSkillId, skills]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !viewedPreset || sortMode !== "default") return;

      // Only reorder enabled skills (they are always at the front)
      const enabledSkills = filtered.filter((s) => s.preset_ids.includes(viewedPreset.id));
      const oldIndex = enabledSkills.findIndex((s) => s.id === active.id);
      const newIndex = enabledSkills.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = [...enabledSkills];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);

      // Optimistic update
      setPresetSkillOrder(reordered.map((s) => s.id));

      try {
        await api.reorderPresetSkills(viewedPreset.id, reordered.map((s) => s.id));
      } catch {
        // Revert on failure
        await api.getPresetSkillOrder(viewedPreset.id).then(setPresetSkillOrder).catch(() => {});
      }
    },
    [filtered, viewedPreset, sortMode]
  );

  const canDrag = !!viewedPreset && sortMode === "default";

  const refreshGitStatus = useCallback(async () => {
    try {
      await api.gitBackupFetch().catch(() => {});
      const status = await api.gitBackupStatus();
      setGitStatus(status);
    } catch {
      // not critical
    }
  }, []);

  // Local-only status refresh: no `git fetch`, so it can fire from
  // dependency-driven effects without driving the file-watcher → refresh
  // → fetch feedback loop.
  const refreshGitStatusLocal = useCallback(async () => {
    try {
      const status = await api.gitBackupStatus();
      setGitStatus(status);
    } catch {
      // not critical
    }
  }, []);

  useEffect(() => {
    (async () => {
      const savedRemote = (await api.getSettings("git_backup_remote_url").catch(() => null))?.trim() || "";
      const status = await api.gitBackupStatus().catch(() => null);
      setGitStatus(status);
      // The saved setting is the single source of truth. Do not backfill from
      // `.git/config` — that made a cleared URL reappear after disconnect (#260).
      setGitRemoteConfig(savedRemote);
    })();
  }, []);

  useEffect(() => {
    const handleWindowFocus = () => {
      refreshGitStatus();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshGitStatus();
      }
    };

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshGitStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshGitStatusLocal();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [skills, refreshGitStatusLocal]);

  useEffect(() => {
    let cancelled = false;
    const loadToggles = async () => {
      if (!selectedSkill || !viewedPreset) {
        setToolToggles(null);
        return;
      }
      if (!selectedSkill.preset_ids.includes(viewedPreset.id)) {
        setToolToggles(null);
        return;
      }
      try {
        const toggles = await api.getSkillToolToggles(selectedSkill.id, viewedPreset.id);
        if (!cancelled) setToolToggles(toggles);
      } catch {
        if (!cancelled) setToolToggles(null);
      }
    };
    loadToggles();
    return () => {
      cancelled = true;
    };
  }, [selectedSkill, viewedPreset]);

  const handleToggleSkillTool = async (toolKey: string, enabled: boolean) => {
    if (!selectedSkill || !viewedPreset) return;
    setTogglingToolKey(toolKey);
    try {
      await api.setSkillToolToggle(selectedSkill.id, viewedPreset.id, toolKey, enabled);
      const displayName = getToolDisplayName(toolKey, tools);
      toast.success(
        enabled
          ? t("mySkills.agentToggleEnabled", { agent: displayName })
          : t("mySkills.agentToggleDisabled", { agent: displayName })
      );
      const [, toggles] = await Promise.all([
        refreshManagedSkills(),
        api.getSkillToolToggles(selectedSkill.id, viewedPreset.id),
      ]);
      setToolToggles(toggles);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
      await refreshManagedSkills();
    } finally {
      setTogglingToolKey(null);
    }
  };

  const handleToggleSkillTarget = useCallback(
    async (skill: ManagedSkill, toolKey: string, enabled: boolean) => {
      if (togglingTarget) return;
      setTogglingTarget({ skillId: skill.id, tool: toolKey });
      const displayName = getToolDisplayName(toolKey, tools);
      try {
        if (enabled) {
          await api.syncSkillToTool(skill.id, toolKey);
          toast.success(t("mySkills.targetInstalled", { name: skill.name, agent: displayName }));
        } else {
          await api.unsyncSkillFromTool(skill.id, toolKey);
          toast.success(t("mySkills.targetUninstalled", { name: skill.name, agent: displayName }));
        }
        await refreshManagedSkills();
      } catch (error: unknown) {
        toast.error(getErrorMessage(error, t("common.error")));
        await refreshManagedSkills();
      } finally {
        setTogglingTarget(null);
      }
    },
    [togglingTarget, tools, t, refreshManagedSkills]
  );

  const scheduleRefreshAfterDelete = useCallback(() => {
    if (refreshAfterDeleteRef.current !== null) {
      window.clearTimeout(refreshAfterDeleteRef.current);
    }
    refreshAfterDeleteRef.current = window.setTimeout(() => {
      refreshAfterDeleteRef.current = null;
      void Promise.all([refreshManagedSkills(), refreshPresets()]);
    }, 300);
  }, [refreshManagedSkills, refreshPresets]);

  useEffect(() => {
    return () => {
      if (refreshAfterDeleteRef.current !== null) {
        window.clearTimeout(refreshAfterDeleteRef.current);
      }
    };
  }, []);

  const handleDeleteSkill = useCallback(
    (skill: ManagedSkill) => {
      setDeletingIds((prev) => {
        if (prev.has(skill.id)) return prev;
        const next = new Set(prev);
        next.add(skill.id);
        return next;
      });
      return (async () => {
        try {
          await api.deleteManagedSkill(skill.id);
          if (selectedSkill?.id === skill.id) closeSkillDetail();
          toast.success(`${skill.name} ${t("mySkills.deleted")}`);
        } catch (error: unknown) {
          toast.error(getErrorMessage(error, t("common.error")));
        } finally {
          setDeletingIds((prev) => {
            if (!prev.has(skill.id)) return prev;
            const next = new Set(prev);
            next.delete(skill.id);
            return next;
          });
          scheduleRefreshAfterDelete();
        }
      })();
    },
    [selectedSkill, closeSkillDetail, t, scheduleRefreshAfterDelete]
  );

  type BatchTask = { id: string; skillId: string; name: string; run: () => Promise<void | Pick<OperationItem, "status" | "message">> };

  async function runOperations(title: string, tasks: BatchTask[]) {
    const execute = async (selected: BatchTask[]) => {
      const items: OperationItem[] = [];
      for (const task of selected) {
        try { const result = await task.run(); items.push({ id: task.id, name: task.name, status: "success", message: t("optimization.completed"), ...result }); }
        catch (cause) { items.push({ id: task.id, name: task.name, status: "failed", message: getErrorMessage(cause, t("common.error")) }); }
      }
      const failedIds = new Set(items.filter(item => item.status === "failed").map(item => tasks.find(task => task.id === item.id)!.skillId));
      setSelectedIds(failedIds);
      if (failedIds.size) setIsMultiSelect(true); else exitMultiSelect();
      const refreshed = await Promise.allSettled([refreshManagedSkills(), refreshPresets(), refreshTools()]);
      if (refreshed.some(result => result.status === "rejected")) toast.warning(t("optimization.refreshFailed"));
      return items;
    };
    const items = await execute(tasks);
    setOperationReport({ title, items, retry: ids => execute(tasks.filter(task => ids.includes(task.id))), inspect: id => { const task = tasks.find(item => item.id === id); if (task) openSkillDetailById(task.skillId); } });
    return items;
  }

  const handleBatchDelete = async () => {
    const tasks = skills.filter(skill => selectedIds.has(skill.id)).map(skill => ({ id: skill.id, skillId: skill.id, name: skill.display_name || skill.name,
      run: async () => { await api.deleteManagedSkill(skill.id); if (selectedSkill?.id === skill.id) closeSkillDetail(); },
    }));
    await runOperations(t("optimization.batchDeleteResults"), tasks);
  };

  const handleBatchEditTags = async (adds: string[], removes: string[]) => {
    const tasks = skills.filter(skill => selectedIds.has(skill.id)).map(skill => ({ id: skill.id, skillId: skill.id, name: skill.display_name || skill.name,
      run: async () => {
        // 重试时读取当前标签，只应用本次增减，不覆盖失败后用户新添加的分类。
        const current = (await api.getManagedSkills()).find(item => item.id === skill.id);
        if (!current) throw new Error("技能已不存在");
        const next = [...new Set([...current.tags.filter(tag => !removes.includes(tag)), ...adds])];
        await api.setSkillTags(skill.id, next);
      },
    }));
    await runOperations(t("optimization.batchTagsResults"), tasks); await refreshAllTags();
  };

  const handleBatchTogglePreset = async () => {
    if (!viewedPreset || batchToggling) return;
    const enabling = anyDisabled, presetId = viewedPreset.id;
    setBatchToggling(true);
    try {
      await runOperations(enabling ? t("optimization.batchEnableResults") : t("optimization.batchDisableResults"), togglableSelectedSkills.map(skill => ({ id: skill.id, skillId: skill.id, name: skill.display_name || skill.name,
        run: () => enabling ? api.addSkillToPreset(skill.id, presetId) : api.removeSkillFromPreset(skill.id, presetId),
      })));
    } finally { setBatchToggling(false); }
  };

  const handleBatchSyncAgents = async (agentKeys: string[]) => {
    const tasks: BatchTask[] = [];
    for (const skill of skills.filter(item => selectedIds.has(item.id))) for (const key of agentKeys) {
      if (skill.targets.some(target => target.tool === key)) continue;
      tasks.push({ id: skill.id + ":" + key, skillId: skill.id, name: (skill.display_name || skill.name) + " → " + (tools.find(tool => tool.key === key)?.display_name || key), run: () => api.syncSkillToTool(skill.id, key) });
    }
    await runOperations(t("optimization.batchDeployResults"), tasks);
  };

  function updateTask(skill: ManagedSkill): BatchTask {
    let failedTools: string[] = [];
    return { id: skill.id, skillId: skill.id, name: skill.display_name || skill.name, run: async () => {
      let deployments: api.DeploymentResult[];
      if (failedTools.length) deployments = await api.retrySkillDeployments(skill.id, failedTools);
      else {
        const result = ["local", "import"].includes(skill.source_type) ? await api.reimportLocalSkill(skill.id) : await api.updateSkill(skill.id);
        if (result.pending_removals.length) return { status: "held", message: t("optimization.heldUpdate") };
        deployments = result.deployments || [];
      }
      failedTools = deployments.filter(item => item.status === "failed").map(item => item.tool);
      return { status: failedTools.length ? "failed" : "success", message: t("optimization.libraryUpdated") + (deployments.length ? "；" + deployments.map(item => item.tool + "：" + item.message).join("；") : "") };
    }};
  }

  const handleBatchRefresh = async () => {
    const targets = skills.filter(skill => selectedIds.has(skill.id) && canRefresh(skill));
    if (!targets.length || batchUpdating) return;
    setBatchUpdating(true);
    try { await runOperations(t("optimization.selectedUpdateResults"), targets.map(updateTask)); }
    finally { setBatchUpdating(false); }
  };

  /** The update the user has been asked to confirm, and what it would remove. */
  const [pendingRemoval, setPendingRemoval] = useState<{
    skill: ManagedSkill;
    removals: api.PendingRemoval[];
    approval: string | null;
    /** Set when the pending replacement is a relink, so confirming re-uses the
     *  directory the user already chose instead of asking for it again. */
    relinkSource?: string;
  } | null>(null);

  const handleUpdateAvailableSkills = async () => {
    const targets = skills.filter(skill => skill.update_status === "update_available" && canRefresh(skill));
    if (!targets.length || batchUpdating) return;
    setBatchUpdating(true);
    try { await runOperations(t("optimization.allUpdateResults"), targets.map(updateTask)); }
    finally { setBatchUpdating(false); }
  };

  const handleCheckAllUpdates = async () => {
    setCheckingAll(true);
    try {
      await api.checkAllSkillUpdates(true);
      toast.success(t("mySkills.updateActions.checkedAll"));
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
    } finally {
      await refreshManagedSkills();
      setCheckingAll(false);
    }
  };

  const handleCheckUpdate = async (skill: ManagedSkill) => {
    setCheckingSkillId(skill.id);
    try {
      await api.checkSkillUpdate(skill.id, true);
      await refreshManagedSkills();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
      await refreshManagedSkills();
    } finally {
      setCheckingSkillId(null);
    }
  };

  function showDeployments(skill: ManagedSkill, deployments?: api.DeploymentResult[]) {
    if (!deployments?.length) return;
    const rows = (results: api.DeploymentResult[]): OperationItem[] => results.map(result => ({
      id: result.tool, name: tools.find(tool => tool.key === result.tool)?.display_name ?? result.tool,
      status: result.status, message: result.message,
    }));
    setOperationReport({ title: t("optimization.deploymentResultsTitle", { name: skill.display_name || skill.name }), items: rows(deployments),
      retry: async keys => { const result = await api.retrySkillDeployments(skill.id, keys); await refreshManagedSkills(); return rows(result); },
    });
    const failed = deployments.filter(result => result.status === "failed");
    if (failed.length) toast.warning(t("optimization.deploymentFailures", { count: failed.length }), { action: { label: t("optimization.viewResults"), onClick: closeSkillDetail } });
  }

  const handleRefreshSkill = async (skill: ManagedSkill, approvedRemovals?: string) => {
    setUpdatingSkillId(skill.id);
    try {
      if (skill.source_type === "local" || skill.source_type === "import") {
        const result = await api.reimportLocalSkill(skill.id, approvedRemovals);
        showDeployments(skill, result.deployments);
        if (result.pending_removals.length > 0) {
          setPendingRemoval({
            skill,
            removals: result.pending_removals,
            approval: result.removal_approval,
          });
          return;
        }
        toast.success(t("mySkills.updateActions.reimported"));
      } else {
        const result = await api.updateSkill(skill.id, approvedRemovals);
        showDeployments(skill, result.deployments);
        // Nothing was changed: the update would have taken away files the new
        // version does not have. Show them and let the user decide (#256).
        if (result.pending_removals.length > 0) {
          setPendingRemoval({
            skill,
            removals: result.pending_removals,
            approval: result.removal_approval,
          });
          return;
        }
        if (result.content_changed) {
          toast.success(t("mySkills.updateActions.updated"));
        } else {
          toast.info(t("mySkills.updateActions.alreadyUpToDate"));
        }
      }
      await refreshManagedSkills();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
      await refreshManagedSkills();
    } finally {
      setUpdatingSkillId(null);
    }
  };

  const handleRelinkSource = async (
    skill: ManagedSkill,
    presetSource?: string,
    approvedRemovals?: string,
  ) => {
    const selected =
      presetSource ?? (await dialogOpen({ directory: true, multiple: false }));
    if (!selected || Array.isArray(selected)) return;

    setUpdatingSkillId(skill.id);
    try {
      const result = await api.relinkLocalSkillSource(
        skill.id,
        selected,
        approvedRemovals,
      );
      showDeployments(skill, result.deployments);
      if (result.pending_removals.length > 0) {
        setPendingRemoval({
          skill,
          removals: result.pending_removals,
          approval: result.removal_approval,
          relinkSource: selected,
        });
        return;
      }
      toast.success(t("mySkills.updateActions.relinked"));
      await refreshManagedSkills();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
      await refreshManagedSkills();
    } finally {
      setUpdatingSkillId(null);
    }
  };

  const handleDetachSource = async (skill: ManagedSkill) => {
    setUpdatingSkillId(skill.id);
    try {
      await api.detachLocalSkillSource(skill.id);
      toast.success(t("mySkills.updateActions.detachedSource"));
      await refreshManagedSkills();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
      await refreshManagedSkills();
    } finally {
      setUpdatingSkillId(null);
    }
  };

  const handleAddTag = async (skill: ManagedSkill, inputValue?: string) => {
    const trimmed = (inputValue ?? tagInput).trim();
    if (!trimmed || skill.tags.includes(trimmed)) {
      setTagInput("");
      return;
    }
    try {
      await api.setSkillTags(skill.id, [...skill.tags, trimmed]);
      toast.success(t("mySkills.tags.tagAdded"));
      setTagEditSkillId(null);
      setTagInput("");
      await refreshManagedSkills();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
    }
  };

  const handleRemoveTag = async (skill: ManagedSkill, tagToRemove: string) => {
    try {
      await api.setSkillTags(skill.id, skill.tags.filter((t) => t !== tagToRemove));
      toast.success(t("mySkills.tags.tagsUpdated"));
      await refreshManagedSkills();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
    }
  };

  // Replace `oldTag` with `newTag` in the active filter set so the current
  // filtering survives a rename/delete.
  const replaceTagInFilters = (oldTag: string, newTag?: string) =>
    setTagFilters((prev) => {
      if (!prev.has(oldTag)) return prev;
      const next = new Set(prev);
      next.delete(oldTag);
      if (newTag) next.add(newTag);
      return next;
    });

  // Throws on failure so the rename dialog stays open (it only closes after a
  // resolved onRename), matching how RenamePresetDialog behaves.
  // 新建 Preset 的入口从侧边栏搬到了技能库筛选条（侧边栏只在 ≥2 个 Preset 时才显示这一段）。
  const handleCreatePreset = async (name: string, description?: string, icon?: string) => {
    await api.createPreset(name, description, icon);
    await Promise.all([refreshPresets(), refreshManagedSkills()]);
    toast.success(t("preset.created"));
  };

  const handleRenameTag = async (newName: string) => {
    const oldName = tagToRename;
    if (oldName === null) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    try {
      await api.renameTag(oldName, trimmed);
      replaceTagInFilters(oldName, trimmed);
      await refreshAllTags();
      toast.success(t("mySkills.tags.tagRenamed"));
      await refreshManagedSkills();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
      throw error;
    }
  };

  const handleDeleteTag = async () => {
    const tag = tagToDelete;
    if (tag === null) return;
    try {
      await api.deleteTag(tag);
      replaceTagInFilters(tag);
      await refreshAllTags();
      toast.success(t("mySkills.tags.tagDeleted"));
      await refreshManagedSkills();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
    }
  };

  const getTagOptions = (skill: ManagedSkill, keyword: string) => {
    const needle = keyword.trim().toLowerCase();
    return allTags.filter((tag) => {
      if (skill.tags.includes(tag)) return false;
      if (!needle) return true;
      return tag.toLowerCase().includes(needle);
    });
  };

  type GitToolbarMode =
    | "loading"
    | "uninitialized"
    | "needs_remote"
    | "needs_fix"
    | "up_to_date"
    | "pending_changes";

  const getGitToolbarMode = (): GitToolbarMode => {
    if (!gitStatus) return "loading";
    if (!gitStatus.is_repo) return "uninitialized";
    if (!gitStatus.remote_url && !gitRemoteConfig) return "needs_remote";
    if (
      gitStatus.upstream_health === "unrelated_histories"
      || gitStatus.upstream_health === "detached"
    ) {
      return "needs_fix";
    }
    // First-push case: remote is set but upstream tracking is not yet established.
    // Treat as a normal pending sync — the push path will set upstream automatically.
    if (gitStatus.upstream_health === "no_upstream") {
      return "pending_changes";
    }
    if (gitStatus.has_changes || gitStatus.ahead > 0 || gitStatus.behind > 0) {
      return "pending_changes";
    }
    return "up_to_date";
  };

  const getGitStatusMeta = (mode: GitToolbarMode) => {
    if (mode === "loading") {
      return {
        icon: Loader2,
        label: t("backup.status.loading"),
        className: "text-muted",
        iconClassName: "animate-spin",
      };
    }
    if (mode === "uninitialized" || mode === "needs_remote") {
      return {
        icon: GitBranch,
        label: t("backup.status.notConnected"),
        className: "text-muted",
        iconClassName: "",
      };
    }
    if (mode === "needs_fix") {
      return {
        icon: Wrench,
        label: t("backup.status.needsFix"),
        className: "text-red-500",
        iconClassName: "",
      };
    }
    if (mode === "pending_changes") {
      return {
        icon: ArrowUpCircle,
        label: t("backup.status.pending"),
        className: "text-amber-600 dark:text-amber-400",
        iconClassName: "",
      };
    }
    return {
      icon: CheckCircle2,
      label: t("backup.status.synced"),
      className: "text-muted",
      iconClassName: "",
    };
  };

  const sourceIcon = (type: string) => {
    switch (type) {
      case "git":
      case "skillssh":
        return <Github className="h-3 w-3" />;
      case "local":
      case "import":
        return <HardDrive className="h-3 w-3" />;
      default:
        return <Globe className="h-3 w-3" />;
    }
  };

  const canRefresh = (skill: ManagedSkill) =>
    skill.source_type === "git" ||
    skill.source_type === "skillssh" ||
    ((skill.source_type === "local" || skill.source_type === "import") && !!skill.source_ref);

  const anyRefreshableSelected = useMemo(
    () => skills.some((skill) => selectedIds.has(skill.id) && canRefresh(skill)),
    [skills, selectedIds]
  );
  const availableUpdateCount = useMemo(
    () => skills.filter((skill) => skill.update_status === "update_available" && canRefresh(skill)).length,
    [skills]
  );
  const refreshableSelectedCount = useMemo(
    () => skills.filter((skill) => selectedIds.has(skill.id) && canRefresh(skill)).length,
    [skills, selectedIds]
  );
  /**
   * Only the selected skills the toggle would actually change — a mixed selection
   * enables the ones that are off, so the button must not count the rest.
   */
  const togglableSelectedSkills = useMemo(() => {
    if (!viewedPreset) return [];
    const enabling = anyDisabled;
    return skills.filter((skill) => {
      if (!selectedIds.has(skill.id)) return false;
      return skill.preset_ids.includes(viewedPreset.id) !== enabling;
    });
  }, [skills, selectedIds, viewedPreset, anyDisabled]);

  const sourceTypeLabel = (skill: ManagedSkill) =>
    skill.source_type === "skillssh" ? "skills.sh" : skill.source_type;

  const refreshLabel = (skill: ManagedSkill) =>
    skill.source_type === "local" || skill.source_type === "import"
      ? t("mySkills.updateActions.reimport")
      : t("mySkills.updateActions.update");

  const statusBadge = (skill: ManagedSkill) => {
    if (skill.update_status === "update_available") {
      return {
        label: "Update",
        className: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
      };
    }
    if (skill.update_status === "source_missing") {
      return {
        label: t("mySkills.updateStatus.sourceMissing"),
        className: "bg-red-500/10 text-red-600 dark:text-red-300",
      };
    }
    if (skill.update_status === "error") {
      return {
        label: t("mySkills.updateStatus.error"),
        className: "bg-red-500/10 text-red-600 dark:text-red-300",
      };
    }
    return null;
  };

  return (
    // 列表视图列多（名称/描述/作者/使用/标签/状态群/操作），沿用 1200 会把描述挤到 100px 以内；
    // 这一档放宽到 1440，网格视图仍按 1200 排卡片。
    <div className={cn("app-page skill-library", viewMode === "list" && "max-w-none xl:max-w-[1440px]")}>
      <SkillRecovery refresh={async () => { await Promise.all([refreshManagedSkills(), refreshPresets()]); }} />
      {operationReport && <OperationResults key={operationReport.version} report={operationReport} onClose={() => setOperationReport(null)} />}
      <div className="app-page-header pr-2 pb-1 flex items-center justify-between gap-3">
        <h1 className="app-page-title flex items-center gap-2">
          {t("mySkills.title")}
          <span className="app-badge">
            {skills.length}
          </span>
        </h1>

      </div>

      <div className="app-toolbar">
        <div className="flex flex-1 items-center gap-3">
          <div className="relative w-full min-w-[200px] max-w-[280px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("mySkills.searchPlaceholder")}
              className="app-input w-full pl-9 font-medium"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>

          <div className="app-segmented app-toolbar-segmented shrink-0">
            {(["all", "enabled", "available"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setFilterMode(mode)}
                className={cn(
                  "app-segmented-button",
                  filterMode === mode && "app-segmented-button-active"
                )}
              >
                {t(`mySkills.filters.${mode}`)}
              </button>
            ))}
          </div>

          <select
            aria-label={t("mySkills.sort.label")}
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as LibrarySortMode)}
            className="app-input w-auto shrink-0"
          >
            <option value="default">{t("mySkills.sort.default")}</option>
            <option value="usage-desc">{t("mySkills.sort.usageDesc")}</option>
            <option value="usage-asc">{t("mySkills.sort.usageAsc")}</option>
          </select>

          {/* 新建 Preset：入口从侧边栏搬到这里（侧边栏只在 ≥2 个 Preset 时显示该段） */}
          <button
            type="button"
            onClick={() => setShowCreatePreset(true)}
            className="app-toolbar-button app-toolbar-button-secondary"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("mySkills.newPreset")}
          </button>

        </div>

        {/* Keep all library actions in one toolbar so they wrap together. */}
        <div className="flex items-center gap-3">
          <div className="app-segmented app-toolbar-segmented shrink-0">
            {(() => {
              const mode = getGitToolbarMode();
              const meta = getGitStatusMeta(mode);
              const Icon = meta.icon;
              return (
                <button
                  type="button"
                  onClick={() => navigate("/backup")}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-3 py-2 text-[13px] font-medium transition-colors hover:bg-surface-hover hover:text-secondary",
                    meta.className
                  )}
                  title={t("sidebar.backup")}
                >
                  <Icon className={cn("h-3.5 w-3.5", meta.iconClassName)} />
                  {meta.label}
                </button>
              );
            })()}
            <button
              onClick={handleCheckAllUpdates}
              disabled={checkingAll}
              className="ml-2 mr-2 inline-flex items-center gap-1 rounded-md border-l border-border-subtle pl-4 pr-3 py-2 text-[13px] font-medium text-muted transition-colors hover:bg-surface-hover hover:text-secondary disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", checkingAll && "animate-spin")} />
              {t("mySkills.updateActions.checkAll")}
            </button>
            <button
              onClick={handleUpdateAvailableSkills}
              disabled={batchUpdating || availableUpdateCount === 0}
              className="mr-2 inline-flex items-center gap-1 rounded-md px-3 py-2 text-[13px] font-medium text-accent-light transition-colors hover:bg-accent-bg disabled:opacity-50"
            >
              <RotateCcw className={cn("h-3.5 w-3.5", batchUpdating && "animate-spin")} />
              {t("mySkills.updateActions.updateAvailable", { count: availableUpdateCount })}
            </button>
            <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 self-center bg-border-subtle" />
            <button
              onClick={() => setViewMode("grid")}
              aria-label={t("mySkills.gridView", { defaultValue: "网格视图" })}
              aria-pressed={viewMode === "grid"}
              className={cn(
                "rounded-md p-2 transition-colors outline-none",
                viewMode === "grid" ? "bg-surface-active text-secondary" : "text-muted hover:text-tertiary"
              )}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              aria-label={t("mySkills.listView", { defaultValue: "列表视图" })}
              aria-pressed={viewMode === "list"}
              className={cn(
                "rounded-md p-2 transition-colors outline-none",
                viewMode === "list" ? "bg-surface-active text-secondary" : "text-muted hover:text-tertiary"
              )}
            >
              <List className="h-4 w-4" />
            </button>

            {/* Selection can stay active in either view. */}
            <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 self-center bg-border-subtle" />
            <button
              type="button"
              aria-pressed={isMultiSelect}
              onClick={() => isMultiSelect ? exitMultiSelect() : setIsMultiSelect(true)}
              className={cn(
                "app-segmented-button inline-flex items-center gap-1.5 hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-border",
                isMultiSelect && "app-segmented-button-active hover:bg-surface-active hover:text-secondary"
              )}
            >
              <SquareCheck className="h-4 w-4" />
              {isMultiSelect ? t("mySkills.cancelSelect") : t("mySkills.selectMode")}
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 px-1 -mt-2 -mb-3">
        {(["local", "import", "git", "skillssh"] as const).map((src) => (
          <button
            key={src}
            onClick={() => applySourceFilter(src)}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[12px] font-medium transition-colors",
              sourceFilters.has(src)
                ? "bg-accent text-white dark:bg-accent dark:text-white"
                : "bg-surface-hover text-muted hover:text-secondary"
            )}
          >
            {t(`mySkills.sourceFilter.${src}`)}
          </button>
        ))}
        {allTags.length > 0 && (
          <>
            <span className="mx-0.5 h-3 w-px bg-border-subtle" />
            {(() => {
              const isActive = tagFilters.has(UNTAGGED_FILTER);
              return (
                <button
                  onClick={() => applyTagFilter(UNTAGGED_FILTER)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium transition-colors",
                    isActive
                      ? "bg-surface-active text-primary"
                      : "border border-dashed border-border text-muted hover:text-secondary"
                  )}
                  title={t("mySkills.tags.untagged")}
                >
                  <CircleSlash className="h-3 w-3" />
                  {t("mySkills.tags.untagged")}
                </button>
              );
            })()}
            {allTags.map((tag) => {
              const isActive = tagFilters.has(tag);
              return (
                <button
                  key={tag}
                  aria-pressed={isActive}
                  onClick={() => applyTagFilter(tag)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setTagMenu({
                      tag,
                      x: Math.min(e.clientX, window.innerWidth - 160),
                      y: Math.min(e.clientY, window.innerHeight - 90),
                    });
                  }}
                  title={t("mySkills.tags.manageHint")}
                  className={cn(
                    "skill-library-filter rounded-full px-2.5 py-0.5 text-[12px] font-medium transition-colors",
                    isActive ? getTagActiveColor(tag, allTags) : getTagColor(tag, allTags)
                  )}
                >
                  {tag}
                  <span className="ml-1 text-[10px] opacity-70">{skills.filter((skill) => skill.tags.includes(tag)).length}</span>
                </button>
              );
            })}
          </>
        )}
        <button type="button" onClick={() => setCreateCategoryOpen(true)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-0.5 text-[12px] text-muted hover:text-secondary">
          <Plus className="h-3 w-3" />{t("mySkills.tags.createCategory")}
        </button>
      </div>

      {isMultiSelect && (
        <MultiSelectToolbar
          selectedCount={selectedIds.size}
          isAllSelected={isAllSelected}
          actions={[
            ...(viewedPreset && togglableSelectedSkills.length > 0
              ? [{
                  key: "toggle",
                  tone: "primary" as const,
                  label: anyDisabled
                    ? t("mySkills.batchEnable", { count: togglableSelectedSkills.length })
                    : t("mySkills.batchDisable", { count: togglableSelectedSkills.length }),
                  icon: anyDisabled
                    ? <CheckCircle2 className="h-3.5 w-3.5" />
                    : <Circle className="h-3.5 w-3.5" />,
                  busy: batchToggling,
                  onSelect: handleBatchTogglePreset,
                }]
              : []),
            {
              key: "sync",
              label: t("mySkills.batchSyncAgents", { count: selectedIds.size }),
              icon: <Share2 className="h-3.5 w-3.5" />,
              onSelect: () => setBatchSyncDialogOpen(true),
            },
            {
              key: "tags",
              label: t("mySkills.batchEditTags", { count: selectedIds.size }),
              icon: <Tag className="h-3.5 w-3.5" />,
              onSelect: () => setBatchTagDialogOpen(true),
            },
          ]}
          overflowActions={[
            ...(anyRefreshableSelected
              ? [{
                  key: "update",
                  label: t("mySkills.batchUpdate", { count: refreshableSelectedCount }),
                  icon: <RotateCcw className="h-3.5 w-3.5" />,
                  busy: batchUpdating,
                  onSelect: handleBatchRefresh,
                }]
              : []),
            {
              key: "delete",
              tone: "danger" as const,
              label: t("mySkills.deleteSelected", { count: selectedIds.size }),
              icon: <Trash2 className="h-3.5 w-3.5" />,
              onSelect: () => setBatchDeleteConfirm(true),
            },
          ]}
          labels={{
            hint: t("mySkills.selectHint"),
            selected: t("mySkills.selectedCount", { count: selectedIds.size }),
            selectAll: t("mySkills.selectAll"),
            deselectAll: t("mySkills.deselectAll"),
            cancel: t("common.cancel"),
            more: t("mySkills.moreActions"),
          }}
          onSelectAll={handleSelectAll}
          onCancel={exitMultiSelect}
        />
      )}

      {filtered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center pb-20 text-center">
          <Layers className="mb-4 h-12 w-12 text-faint" />
          <h3 className="mb-1.5 text-[14px] font-semibold text-tertiary">{t("mySkills.noSkills")}</h3>
          <p className="text-[13px] text-muted">
            {skills.length === 0 ? t("mySkills.addFirst") : t("mySkills.noMatch")}
          </p>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="app-button-secondary mt-4">
              {t("mySkills.clearFilters")}
            </button>
          )}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={filtered.map((s) => s.id)}
            strategy={viewMode === "grid" ? rectSortingStrategy : verticalListSortingStrategy}
          >
          <div
            className={cn(
              "pb-8",
              viewMode === "grid"
                ? "grid grid-cols-2 gap-3 lg:grid-cols-3"
                : "flex flex-col gap-0.5"
            )}
          >
          {filtered.map((skill) => {
            const enabledInPreset = viewedPreset
              ? skill.preset_ids.includes(viewedPreset.id)
              : false;
            const badge = statusBadge(skill);
            const hasUpdate =
              skill.update_status === "update_available" && canRefresh(skill);
            // The header pill is hidden in multi-select, so the body badge has to
            // take over — otherwise the update state vanishes entirely.
            const showUpdatePill = hasUpdate && !isMultiSelect;
            const isMissingLocalSource =
              skill.update_status === "source_missing"
              && (skill.source_type === "local" || skill.source_type === "import");
            const displayName = skillDisplayNames.get(skill.id) || skill.name;
            const LogoIcon = skillIconOption(skill).icon;
            // 命中不在展示出来的名字里时，需要说明「为什么这条被搜到」；
            // 描述类命中另把命中处前后的文字截出来，避免高亮落在被截断的后半段。
            const term = search.trim();
            const match: SkillSearchMatch | null = term ? searchMatches.get(skill.id) ?? null : null;
            const matchHidden = Boolean(match?.field) && !displayName.toLowerCase().includes(term.toLowerCase());
            const descriptionText = match && (match.field === "description" || match.field === "customDescription")
              ? matchSnippet(match, term)
              : skill.display_description || "—";
            const matchChip = matchHidden && match?.field ? (
              <span
                className="mr-1 inline-flex shrink-0 rounded bg-accent-bg px-1 py-px align-middle text-[10.5px] font-medium text-accent-dark dark:text-accent-light"
                title={t("mySkills.searchMatch.hint", { snippet: matchSnippet(match, term) })}
              >
                {t("mySkills.searchMatch.chip", { field: t(`mySkills.searchMatch.${match.field}`) })}
              </span>
            ) : null;

            if (viewMode === "grid") {
              return (
                <SortableSkillItem
                  key={skill.id}
                  id={skill.id}
                  disabled={!canDrag}
                  className={
                    tagEditSkillId === skill.id || menuSkillId === skill.id
                      ? "relative z-30"
                      : undefined
                  }
                  handleTitle={t("mySkills.dragToReorder")}
                  handleClassName="absolute inset-0 flex cursor-grab items-center justify-center rounded text-faint opacity-0 transition-opacity hover:text-muted group-hover:opacity-100 active:cursor-grabbing"
                >
                {(dragHandle) => (
                <div
                  className={cn(
                    "app-panel group relative flex h-full cursor-pointer flex-col shadow-card transition-all hover:-translate-y-px hover:border-border hover:shadow-card-hover",
                    isMultiSelect && selectedIds.has(skill.id) && "ring-1 ring-accent border-accent/40"
                  )}
                  onClick={() =>
                    isMultiSelect ? toggleSelect(skill.id) : openSkillDetailById(skill.id)
                  }
                >
                  {deletingIds.has(skill.id) && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-surface/70 backdrop-blur-[1px]">
                      <Loader2 className="h-5 w-5 animate-spin text-muted" />
                    </div>
                  )}

                  <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-1.5">
                    {/* Fixed-width slot: status dot / drag handle on hover / checkbox in multi-select */}
                    <div className={cn("relative flex h-4 w-4 shrink-0 items-center justify-center", !isMultiSelect && "skill-library-marker")}>
                      {!isMultiSelect && <LogoIcon aria-hidden="true" className={cn("h-4 w-4", canDrag && "group-hover:opacity-0")} />}
                      {isMultiSelect ? (
                        selectedIds.has(skill.id)
                          ? <SquareCheck className="h-3.5 w-3.5 text-accent" />
                          : <Square className="h-3.5 w-3.5 text-faint" />
                      ) : (
                        <>
                          <span
                            className={cn(
                              "skill-library-presence h-2 w-2 rounded-full transition-opacity",
                              canDrag && "group-hover:opacity-0",
                              enabledInPreset
                                ? "bg-accent-light shadow-[0_0_0_3px_var(--color-accent-bg)]"
                                : "bg-surface-active"
                            )}
                            title={enabledInPreset ? t("mySkills.enabledButton") : t("mySkills.notInPreset")}
                          />
                          {dragHandle}
                        </>
                      )}
                    </div>
                    <h3
                      className="flex-1 truncate text-[14px] font-semibold text-primary group-hover:text-accent-light"
                      title={displayName}
                    >
                      <HighlightText text={displayName} query={search} />
                    </h3>
                    {showUpdatePill && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRefreshSkill(skill); }}
                        disabled={updatingSkillId === skill.id}
                        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-medium text-amber-600 outline-none transition-colors hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-400"
                        title={refreshLabel(skill)}
                      >
                        <RotateCcw className={cn("h-2.5 w-2.5", updatingSkillId === skill.id && "animate-spin")} />
                        {t("mySkills.updateActions.update")}
                      </button>
                    )}
                    {!isMultiSelect && (
                      <>
                        <CardActionMenu
                          label={t("mySkills.moreActions")}
                          onOpenChange={(open) => setMenuSkillId(open ? skill.id : null)}
                          className={cn(
                            "transition-opacity",
                            menuSkillId === skill.id
                              ? "opacity-100"
                              : "opacity-0 group-hover:opacity-100"
                          )}
                          actions={[
                            {
                              key: "check",
                              label: t("mySkills.updateActions.check"),
                              icon: <RefreshCw className={cn("h-3.5 w-3.5", checkingSkillId === skill.id && "animate-spin")} />,
                              disabled: checkingSkillId === skill.id,
                              onSelect: () => handleCheckUpdate(skill),
                            },
                            ...(canRefresh(skill)
                              ? [{
                                  key: "refresh",
                                  label: refreshLabel(skill),
                                  icon: <RotateCcw className={cn("h-3.5 w-3.5", updatingSkillId === skill.id && "animate-spin")} />,
                                  disabled: updatingSkillId === skill.id,
                                  onSelect: () => handleRefreshSkill(skill),
                                }]
                              : []),
                            {
                              key: "profile",
                              label: t("mySkills.profile.action"),
                              icon: <Pencil className="h-3.5 w-3.5" />,
                              onSelect: () => setProfileSkillId(skill.id),
                            },
                            {
                              key: "delete",
                              label: t("common.delete"),
                              icon: <Trash2 className="h-3.5 w-3.5" />,
                              danger: true,
                              onSelect: () => setSkillToDelete(skill),
                            },
                          ]}
                        />
                      </>
                    )}
                  </div>

                  <div className="px-3.5 pb-3">
                    {skill.alias && (
                      <p className="mb-0.5 truncate text-[11.5px] text-faint" title={`${t("mySkills.detail.aliasLabel")}: ${skill.name}`}>
                        {t("mySkills.detail.aliasLabel")}: <HighlightText text={skill.name} query={search} />
                      </p>
                    )}
                    <p className="text-[13px] leading-[18px] text-muted line-clamp-2" title={skill.display_description ?? undefined}>
                      {matchChip}
                      <HighlightText text={descriptionText} query={search} />
                    </p>
                    <p className="mt-1 truncate text-[12px] text-faint" title={skill.display_author_source ?? undefined}>
                      {t("mySkills.author")}: {skill.display_author || t("mySkills.authorMissing")}
                      {skill.author_override ? ` · ${t("mySkills.profile.custom")}` : ""}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[12px] text-faint">
                      {usage[skill.id] ? (
                        <>
                          <span className="text-tertiary">{t("mySkills.usage.count", { count: usage[skill.id].count })}</span>
                          {usage[skill.id].lastUsedAt !== null && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span title={new Date(usage[skill.id].lastUsedAt!).toLocaleString(i18n.language)}>
                                {t("mySkills.usage.lastUsed", { time: formatUsageTime(usage[skill.id].lastUsedAt) })}
                              </span>
                            </>
                          )}
                        </>
                      ) : (
                        <span title={t("mySkills.usage.neverHint")}>{t("mySkills.usage.never")}</span>
                      )}
                    </p>
                    {((badge && !showUpdatePill) || conflictIds.has(skill.id)) && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {conflictIds.has(skill.id) && (
                          <button
                            onClick={(e) => { e.stopPropagation(); navigate("/backup"); }}
                            className="rounded-full bg-amber-500/12 px-2 py-0.5 text-[13px] font-medium text-amber-600 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
                            title={t("mySkills.needsAttentionHint")}
                          >
                            {t("mySkills.needsAttention")}
                          </button>
                        )}
                        {badge && !showUpdatePill && (
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[13px] font-medium",
                              badge.className
                            )}
                          >
                            {badge.label}
                          </span>
                        )}
                        {isMissingLocalSource && (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleRelinkSource(skill); }}
                              disabled={updatingSkillId === skill.id}
                              className="rounded-full border border-border-subtle px-2 py-0.5 text-[12px] font-medium text-secondary transition-colors hover:bg-surface-hover disabled:opacity-50"
                            >
                              {t("mySkills.updateActions.relink")}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDetachSource(skill); }}
                              disabled={updatingSkillId === skill.id}
                              className="rounded-full border border-border-subtle px-2 py-0.5 text-[12px] font-medium text-muted transition-colors hover:bg-surface-hover hover:text-secondary disabled:opacity-50"
                            >
                              {t("mySkills.updateActions.detachSource")}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {skill.tags.map((tag) => (
                        <span
                          key={tag}
                          className={cn(
                            "group/tag inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                            getTagColor(tag, allTags)
                          )}
                        >
                          {tag}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRemoveTag(skill, tag); }}
                            className="hidden group-hover/tag:inline-flex rounded-full p-0 opacity-60 hover:opacity-100"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </span>
                      ))}
                      {tagEditSkillId === skill.id ? (
                        <div className="relative" onClick={(e) => e.stopPropagation()}>
                          <input
                            ref={tagInputRef}
                            type="text"
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { handleAddTag(skill); }
                              if (e.key === "Escape") { setTagEditSkillId(null); setTagInput(""); }
                            }}
                            onBlur={() => {
                              if (tagInput.trim()) handleAddTag(skill);
                              else { setTagEditSkillId(null); setTagInput(""); }
                            }}
                            placeholder={t("mySkills.tags.addTag")}
                            className="h-5 w-28 rounded-full border border-border-subtle bg-transparent px-1.5 text-[11px] text-secondary outline-none focus:border-accent"
                            autoCapitalize="none"
                            autoCorrect="off"
                            autoComplete="off"
                            spellCheck={false}
                            autoFocus
                          />
                          {getTagOptions(skill, tagInput).length > 0 && (
                            <div className="absolute left-0 top-6 z-50 max-h-56 min-w-[112px] max-w-[180px] overflow-y-auto rounded-md border border-border-subtle bg-surface p-1 shadow-lg">
                              {getTagOptions(skill, tagInput).map((tagOption) => (
                                <button
                                  key={tagOption}
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={(e) => { e.stopPropagation(); handleAddTag(skill, tagOption); }}
                                  className="w-full truncate rounded px-1.5 py-1 text-left text-[11px] text-secondary hover:bg-surface-hover"
                                  title={tagOption}
                                >
                                  {tagOption}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); setTagEditSkillId(skill.id); setTagInput(""); }}
                          className="inline-flex items-center rounded-full p-0.5 text-faint transition-colors hover:text-muted opacity-0 group-hover:opacity-100"
                          title={t("mySkills.tags.addTag")}
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-2 border-t border-border-faint px-3.5 py-2.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-muted">
                        {sourceIcon(skill.source_type)}
                        {sourceTypeLabel(skill)}
                      </span>
                      {enabledInPreset && (
                        <>
                          <span className="text-faint">·</span>
                          <span className="truncate text-[12px] font-medium text-amber-600 dark:text-amber-400/80">
                            {viewedPresetName}
                          </span>
                        </>
                      )}
                    </div>
                    <SyncDots
                      className="shrink-0"
                      skill={skill}
                      tools={tools}
                      limit={6}
                      onToggle={
                        isMultiSelect
                          ? undefined
                          : (tool, enabled) => handleToggleSkillTarget(skill, tool, enabled)
                      }
                      pendingKey={togglingTarget?.skillId === skill.id ? togglingTarget.tool : null}
                    />
                  </div>
                </div>
                )}
                </SortableSkillItem>
              );
            }

            return (
              <SortableSkillItem
                key={skill.id}
                id={skill.id}
                disabled={!canDrag}
                className={menuSkillId === skill.id ? "relative z-30" : undefined}
                handleTitle={t("mySkills.dragToReorder")}
                handleClassName="absolute inset-0 flex cursor-grab items-center justify-center rounded text-faint opacity-0 transition-opacity hover:text-muted group-hover:opacity-100 active:cursor-grabbing"
              >
              {(dragHandle) => (
              <div
                className={cn(
                  "app-panel group relative flex cursor-pointer items-center gap-3 rounded-xl border-transparent px-3.5 py-3 transition-all hover:border-border hover:bg-surface-hover max-[1000px]:flex-wrap",
                  isMultiSelect && selectedIds.has(skill.id) && "ring-1 ring-accent border-accent/40"
                )}
                onClick={() =>
                  isMultiSelect ? toggleSelect(skill.id) : openSkillDetailById(skill.id)
                }
              >
                {deletingIds.has(skill.id) && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-surface/70 backdrop-blur-[1px]">
                    <Loader2 className="h-5 w-5 animate-spin text-muted" />
                  </div>
                )}
                {/* Same fixed slot as the grid card: status dot / drag handle / checkbox */}
                <div className={cn("relative flex h-4 w-4 shrink-0 items-center justify-center", !isMultiSelect && "skill-library-marker")}>
                  {!isMultiSelect && <LogoIcon aria-hidden="true" className={cn("h-4 w-4", canDrag && "group-hover:opacity-0")} />}
                  {isMultiSelect ? (
                    selectedIds.has(skill.id)
                      ? <SquareCheck className="h-3.5 w-3.5 text-accent" />
                      : <Square className="h-3.5 w-3.5 text-faint" />
                  ) : (
                    <>
                      <span
                        className={cn(
                          "skill-library-presence h-2 w-2 rounded-full transition-opacity",
                          canDrag && "group-hover:opacity-0",
                          enabledInPreset
                            ? "bg-accent-light shadow-[0_0_0_3px_var(--color-accent-bg)]"
                            : "bg-surface-active"
                        )}
                        title={enabledInPreset ? t("mySkills.enabledButton") : t("mySkills.notInPreset")}
                      />
                      {dragHandle}
                    </>
                  )}
                </div>

                <h3
                  className="w-[150px] shrink-0 truncate text-[14px] font-semibold text-secondary group-hover:text-primary 2xl:w-[190px]"
                  title={skill.alias ? `${displayName} (${skill.name})` : displayName}
                >
                  <HighlightText text={displayName} query={search} />
                </h3>

                {/* 列表视图靠固定列宽对齐：除描述列用 flex-1 吸收剩余空间外，
                    其余列一律给死宽度，否则每行内容长度不同会把后面的列推歪。 */}
                <p className="min-w-0 flex-1 truncate text-[13px] text-muted" title={skill.display_description ?? undefined}>
                  {matchChip}
                  <HighlightText text={descriptionText} query={search} />
                </p>
                <span className="hidden w-[96px] shrink-0 truncate text-[12px] text-faint 2xl:block" title={skill.display_author_source ?? undefined}>
                  {skill.display_author || t("mySkills.authorMissing")}
                </span>
                <span className="hidden w-[120px] shrink-0 truncate text-[12px] text-faint xl:block"
                  title={usage[skill.id]?.lastUsedAt ? new Date(usage[skill.id].lastUsedAt!).toLocaleString(i18n.language) : t("mySkills.usage.neverHint")}>
                  {usage[skill.id]
                    ? usage[skill.id].lastUsedAt !== null
                      ? `${t("mySkills.usage.count", { count: usage[skill.id].count })} · ${formatUsageTime(usage[skill.id].lastUsedAt)}`
                      : t("mySkills.usage.count", { count: usage[skill.id].count })
                    : t("mySkills.usage.never")}
                </span>

                <div className="hidden w-[110px] shrink-0 items-center gap-1.5 overflow-hidden 2xl:flex">
                  {skill.tags.map((tag) => (
                    <span
                      key={tag}
                      className={cn(
                        "inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[11px] font-medium",
                        getTagColor(tag, allTags)
                      )}
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                {/* 状态、Agent 与来源不能共挤；长文本可缩略，徽章保持单行。 */}
                <div className="flex min-h-6 w-[344px] shrink-0 items-center justify-end gap-2">
                  {conflictIds.has(skill.id) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate("/backup"); }}
                      className="max-w-[96px] shrink-0 truncate rounded-full bg-amber-500/12 px-2 py-0.5 text-[12px] font-medium leading-5 text-amber-600 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
                      title={t("mySkills.needsAttentionHint")}
                    >
                      {t("mySkills.needsAttention")}
                    </button>
                  )}
                  {hasUpdate && !isMultiSelect ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRefreshSkill(skill); }}
                      disabled={updatingSkillId === skill.id}
                      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-medium leading-5 text-amber-600 outline-none transition-colors hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-400"
                      title={refreshLabel(skill)}
                    >
                      <RotateCcw className={cn("h-2.5 w-2.5", updatingSkillId === skill.id && "animate-spin")} />
                      {t("mySkills.updateActions.update")}
                    </button>
                  ) : badge && (
                    <span
                      className={cn(
                        "inline-flex max-w-[96px] shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-medium leading-5",
                        badge.className
                      )}
                    >
                      <span className="truncate" title={badge.label}>{badge.label}</span>
                    </span>
                  )}
                  <SyncDots
                    skill={skill}
                    tools={tools}
                    limit={6}
                    size="sm"
                    className="shrink-0"
                    onToggle={
                      isMultiSelect
                        ? undefined
                        : (tool, enabled) => handleToggleSkillTarget(skill, tool, enabled)
                    }
                    pendingKey={togglingTarget?.skillId === skill.id ? togglingTarget.tool : null}
                  />
                  <span className="inline-flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-[13px] text-muted" title={sourceTypeLabel(skill)}>
                    {sourceIcon(skill.source_type)}
                    <span className="truncate">{sourceTypeLabel(skill)}</span>
                  </span>
                  {enabledInPreset && (
                    <span className="min-w-0 max-w-[72px] truncate text-[13px] font-medium text-amber-600 dark:text-amber-400/80" title={viewedPresetName}>
                      {viewedPresetName}
                    </span>
                  )}
                </div>

                {/* 固定宽度的槽位：即使没有缺失来源，也占住这一列，否则有/无该列的行会错位。 */}
                <div className="flex w-[64px] shrink-0 items-center justify-end gap-1">
                  {isMissingLocalSource && !isMultiSelect && (
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRelinkSource(skill); }}
                      disabled={updatingSkillId === skill.id}
                      title={t("mySkills.updateActions.relink")}
                      aria-label={t("mySkills.updateActions.relink")}
                      className="inline-flex h-5 w-6 shrink-0 items-center justify-center rounded text-secondary transition-colors hover:bg-surface-hover disabled:opacity-50"
                    >
                      <Wrench className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDetachSource(skill); }}
                      disabled={updatingSkillId === skill.id}
                      title={t("mySkills.updateActions.detachSource")}
                      aria-label={t("mySkills.updateActions.detachSource")}
                      className="inline-flex h-5 w-6 shrink-0 items-center justify-center rounded text-muted transition-colors hover:bg-surface-hover hover:text-secondary disabled:opacity-50"
                    >
                      <HardDrive className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  )}
                </div>

                {!isMultiSelect && (
                  <div className="flex w-[32px] shrink-0 items-center justify-end">
                    <CardActionMenu
                      label={t("mySkills.moreActions")}
                      onOpenChange={(open) => setMenuSkillId(open ? skill.id : null)}
                      className={cn(
                        "transition-opacity",
                        menuSkillId === skill.id
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100"
                      )}
                      actions={[
                        {
                          key: "check",
                          label: t("mySkills.updateActions.check"),
                          icon: <RefreshCw className={cn("h-3.5 w-3.5", checkingSkillId === skill.id && "animate-spin")} />,
                          disabled: checkingSkillId === skill.id,
                          onSelect: () => handleCheckUpdate(skill),
                        },
                        ...(canRefresh(skill)
                          ? [{
                              key: "refresh",
                              label: refreshLabel(skill),
                              icon: <RotateCcw className={cn("h-3.5 w-3.5", updatingSkillId === skill.id && "animate-spin")} />,
                              disabled: updatingSkillId === skill.id,
                              onSelect: () => handleRefreshSkill(skill),
                            }]
                          : []),
                        {
                          key: "profile",
                          label: t("mySkills.profile.action"),
                          icon: <Pencil className="h-3.5 w-3.5" />,
                          onSelect: () => setProfileSkillId(skill.id),
                        },
                        {
                          key: "delete",
                          label: t("common.delete"),
                          icon: <Trash2 className="h-3.5 w-3.5" />,
                          danger: true,
                          onSelect: () => setSkillToDelete(skill),
                        },
                      ]}
                    />
                  </div>
                )}
              </div>
              )}
              </SortableSkillItem>
            );
          })}
        </div>
          </SortableContext>
        </DndContext>
      )}

      <SkillProfileDialog
        skill={skills.find((item) => item.id === profileSkillId) ?? null}
        allTags={allTags}
        onClose={() => setProfileSkillId(null)}
        onSaved={() => {
          void refreshManagedSkills();
          toast.success(t("mySkills.profile.saved"));
        }}
      />

      <SkillDetailPanel
        key={selectedSkill?.id ?? "skill-detail-empty"}
        skill={selectedSkill}
        onClose={closeSkillDetail}
        tools={tools}
        toolToggles={toolToggles}
        togglingTool={togglingToolKey}
        onToggleTool={handleToggleSkillTool}
        projects={projects}
        onProjectsChanged={refreshProjects}
        onEditProfile={(skill) => setProfileSkillId(skill.id)}
        onUpdate={handleRefreshSkill}
        busyAction={updatingSkillId ?? checkingSkillId}
      />

      <ConfirmDialog
        open={pendingRemoval !== null}
        tone="warning"
        title={t("mySkills.updateActions.removalTitle")}
        message={t("mySkills.updateActions.removalMessage", {
          name: pendingRemoval?.skill.name ?? "",
          count: pendingRemoval?.removals.length ?? 0,
        })}
        // Every path, never a truncated sample: recognising one's own file is
        // the whole point, and it might be the twenty-first.
        details={pendingRemoval?.removals.map((r) =>
          r.location === "library" ? r.path : `${r.location}: ${r.path}`
        )}
        confirmLabel={t("mySkills.updateActions.removalConfirm")}
        onClose={() => setPendingRemoval(null)}
        onConfirm={async () => {
          const target = pendingRemoval?.skill;
          const approval = pendingRemoval?.approval ?? undefined;
          const relinkSource = pendingRemoval?.relinkSource;
          setPendingRemoval(null);
          if (!target) return;
          if (relinkSource) {
            await handleRelinkSource(target, relinkSource, approval);
          } else {
            await handleRefreshSkill(target, approval);
          }
        }}
      />
      <ConfirmDialog
        open={batchDeleteConfirm}
        message={t("mySkills.batchDeleteConfirm", { count: selectedIds.size })}
        onClose={() => setBatchDeleteConfirm(false)}
        onConfirm={handleBatchDelete}
      />
      <ConfirmDialog
        open={skillToDelete !== null}
        title={t("mySkills.delete")}
        message={t("mySkills.deleteConfirm", { name: skillToDelete?.name || "" })}
        onClose={() => setSkillToDelete(null)}
        onConfirm={async () => {
          if (skillToDelete) await handleDeleteSkill(skillToDelete);
        }}
      />
      <ConfirmDialog
        open={tagToDelete !== null}
        title={t("mySkills.tags.deleteTag")}
        message={t("mySkills.tags.deleteConfirm", { tag: tagToDelete || "" })}
        onClose={() => setTagToDelete(null)}
        onConfirm={handleDeleteTag}
      />
      <TagRenameDialog
        open={tagToRename !== null}
        currentName={tagToRename || ""}
        onClose={() => setTagToRename(null)}
        onRename={handleRenameTag}
      />
      <CreatePresetDialog
        open={showCreatePreset}
        onClose={() => setShowCreatePreset(false)}
        onCreate={handleCreatePreset}
      />
      <TagRenameDialog
        open={createCategoryOpen}
        currentName=""
        title={t("mySkills.tags.createCategory")}
        onClose={() => setCreateCategoryOpen(false)}
        onRename={async (name) => {
          try {
            await api.createSkillCategory(name);
            await refreshAllTags();
            toast.success(t("mySkills.tags.tagAdded"));
          } catch (error: unknown) {
            toast.error(getErrorMessage(error, t("common.error")));
            throw error;
          }
        }}
      />
      {tagMenu && (
        <>
          {/* Backdrop closes on left- or right-click outside the menu. Explicit
              z-index (z-40/z-50) to avoid the macOS WKWebView stacking bug. */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setTagMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setTagMenu(null);
            }}
          />
          <div
            className="fixed z-50 min-w-[140px] overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-2xl"
            style={{ top: tagMenu.y, left: tagMenu.x }}
          >
            <button
              onClick={() => {
                setTagToRename(tagMenu.tag);
                setTagMenu(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-secondary hover:bg-surface-hover"
            >
              <Pencil className="h-3.5 w-3.5" />
              {t("mySkills.tags.renameTag")}
            </button>
            <button
              onClick={() => {
                setTagToDelete(tagMenu.tag);
                setTagMenu(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-red-400 hover:bg-surface-hover"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("mySkills.tags.deleteTag")}
            </button>
          </div>
        </>
      )}
      <BatchTagDialog
        open={batchTagDialogOpen}
        skills={skills.filter((s) => selectedIds.has(s.id))}
        allTags={allTags}
        onClose={() => setBatchTagDialogOpen(false)}
        onApply={handleBatchEditTags}
      />

      <BatchSyncAgentDialog
        open={batchSyncDialogOpen}
        skills={skills.filter((s) => selectedIds.has(s.id))}
        tools={tools}
        onClose={() => setBatchSyncDialogOpen(false)}
        onApply={handleBatchSyncAgents}
      />
    </div>
  );
}
