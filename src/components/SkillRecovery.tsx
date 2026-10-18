import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, History, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ConfirmDialog } from "./ConfirmDialog";
import { useApp } from "../context/AppContext";
import { invoke } from "../lib/transport";
import { getErrorMessage } from "../lib/error";

interface SkillSnapshot {
  snapshot_id: string;
  skill_id: string;
  name: string;
  reason: string;
  created_at: number;
  deleted: boolean;
  file_count: number;
  size_bytes: number;
}
interface RestoreResult {
  skill: { id: string; name: string };
  snapshot_id: string;
  safety_snapshot_id: string | null;
  deployments: { tool: string; status: "success" | "failed"; message: string }[];
}
interface SnapshotUsage {
  total_bytes: number;
  total_count: number;
  skill_count: number;
  by_skill: { skill_id: string; name: string; count: number; size_bytes: number; latest_at: number }[];
}
interface CleanupPlan {
  keep_latest: number;
  skill_id: string | null;
  reclaim_bytes: number;
  removable: { snapshot_id: string; skill_id: string; name: string; reason: string; created_at: number; file_count: number; size_bytes: number }[];
}
interface CleanupResult {
  deleted: number;
  reclaim_bytes: number;
  failed: { snapshot_id: string; message: string }[];
  keep_latest: number;
}

// 快照是技能目录的完整复制，体积动辄几十 MB：用 MB/KB 展示比裸字节数可读。
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

const KEEP_OPTIONS = [1, 2, 3, 5];

export function SkillRecovery({ refresh }: { refresh: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const { managedSkills, tools } = useApp();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [snapshots, setSnapshots] = useState<SkillSnapshot[]>([]);
  const [usage, setUsage] = useState<SnapshotUsage | null>(null);
  const [skillFilter, setSkillFilter] = useState("");
  const [keepLatest, setKeepLatest] = useState(2);
  const [cleanupPlan, setCleanupPlan] = useState<CleanupPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SkillSnapshot | null>(null);
  const [result, setResult] = useState<RestoreResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, nextUsage] = await Promise.all([
        invoke<SkillSnapshot[]>("get_skill_snapshots", {}),
        invoke<SnapshotUsage>("get_snapshot_usage", {}),
      ]);
      setSnapshots(list);
      setUsage(nextUsage);
      setError(null);
    } catch (error) {
      setError(getErrorMessage(error, t("common.error")));
    } finally {
      setLoading(false);
    }
  }, [t]);
  useEffect(() => {
    if (open) void load();
  }, [open, managedSkills, load]);

  const visible = useMemo(
    () => (skillFilter ? snapshots.filter(snapshot => snapshot.skill_id === skillFilter) : snapshots),
    [snapshots, skillFilter]
  );

  const restore = async () => {
    if (!selected) return;
    try {
      const restored = await invoke<RestoreResult>("restore_skill_snapshot", { snapshotId: selected.snapshot_id });
      setResult(restored);
      if (restored.deployments.some(item => item.status === "failed")) {
        toast.warning(t("mySkills.recovery.partial", { defaultValue: "技能已恢复，部分 Agent 副本需要处理" }));
      } else {
        toast.success(t("mySkills.recovery.restored", { defaultValue: "技能已恢复" }));
      }
      await refresh();
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, t("common.error")));
    }
  };

  // 清理分两步：先让后端算出「可删哪些、能回收多少」，用户确认后再删。
  // 后端执行时会再核一遍，每个技能的最近 keepLatest 个恢复点无论如何都不删。
  const previewCleanup = async () => {
    try {
      const plan = await invoke<CleanupPlan>("preview_snapshot_cleanup", {
        keepLatest,
        skillId: skillFilter || undefined,
      });
      if (plan.removable.length === 0) {
        toast.info(t("mySkills.recovery.cleanupNothing", { defaultValue: "没有可清理的旧快照，每个技能都只保留了最近几个恢复点。" }));
        return;
      }
      setCleanupPlan(plan);
    } catch (error) {
      toast.error(getErrorMessage(error, t("common.error")));
    }
  };

  const runCleanup = async () => {
    if (!cleanupPlan) return;
    try {
      const cleaned = await invoke<CleanupResult>("cleanup_snapshots", {
        snapshotIds: cleanupPlan.removable.map(item => item.snapshot_id),
        keepLatest,
      });
      if (cleaned.failed.length > 0) {
        toast.warning(t("mySkills.recovery.cleanupPartial", {
          defaultValue: "已清理 {{deleted}} 个快照，{{failed}} 个被跳过（多为最近恢复点）",
          deleted: cleaned.deleted,
          failed: cleaned.failed.length,
        }));
      } else {
        toast.success(t("mySkills.recovery.cleanupDone", {
          defaultValue: "已清理 {{deleted}} 个快照，回收 {{size}}",
          deleted: cleaned.deleted,
          size: formatBytes(cleaned.reclaim_bytes),
        }));
      }
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, t("common.error")));
    }
  };

  const reasons: Record<string, string> = {
    before_delete: t("mySkills.recovery.beforeDelete", { defaultValue: "删除前" }),
    before_update: t("mySkills.recovery.beforeUpdate", { defaultValue: "更新前" }),
    before_restore: t("mySkills.recovery.beforeRestore", { defaultValue: "恢复前" }),
  };

  return (
    <section className="rounded-lg border border-border-subtle bg-surface">
      <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls="skill-recovery-list"
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-secondary outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent">
        <History className="h-4 w-4" />
        <span className="flex-1">{t("mySkills.recovery.title", { defaultValue: "技能恢复" })}</span>
        {usage && usage.total_count > 0 && <span className="text-[11px] text-muted">{formatBytes(usage.total_bytes)}</span>}
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && <div id="skill-recovery-list" aria-busy={loading} className="border-t border-border-subtle px-3 py-3">
        <p className="mb-3 text-[12px] text-muted">{t("mySkills.recovery.hint", { defaultValue: "更新和删除前自动保存技能快照，可恢复单个技能。恢复会保留当前版本，并保护 Agent 副本里的本地改动。" })}</p>
        {error && <div role="alert" className="mb-3 flex items-center gap-2 text-[12px] text-red-500">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => void load()} className="rounded px-2 py-1 text-secondary outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent">{t("common.retry")}</button>
        </div>}
        {usage && usage.total_count > 0 && <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-muted">{t("mySkills.recovery.usage", {
            defaultValue: "共 {{count}} 个快照 · {{skills}} 个技能 · 占用 {{size}}",
            count: usage.total_count, skills: usage.skill_count, size: formatBytes(usage.total_bytes),
          })}</span>
          <span className="flex-1" />
          <select aria-label={t("mySkills.recovery.filter", { defaultValue: "按技能筛选快照" })}
            value={skillFilter} onChange={event => setSkillFilter(event.target.value)}
            className="max-w-[180px] rounded border border-border-subtle bg-surface px-2 py-1 text-[12px] text-secondary outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <option value="">{t("mySkills.recovery.allSkills", { defaultValue: "全部技能" })}</option>
            {usage.by_skill.map(item => <option key={item.skill_id} value={item.skill_id}>{item.name}（{item.count}）</option>)}
          </select>
          <select aria-label={t("mySkills.recovery.keepLatest", { defaultValue: "每个技能保留的恢复点数量" })}
            value={keepLatest} onChange={event => setKeepLatest(Number(event.target.value))}
            className="rounded border border-border-subtle bg-surface px-2 py-1 text-[12px] text-secondary outline-none focus-visible:ring-2 focus-visible:ring-accent">
            {KEEP_OPTIONS.map(count => <option key={count} value={count}>{t("mySkills.recovery.keepOption", { defaultValue: "保留最近 {{count}} 个", count })}</option>)}
          </select>
          <button type="button" onClick={() => void previewCleanup()}
            className="flex items-center gap-1 rounded px-2 py-1 text-[12px] text-secondary outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent">
            <Trash2 className="h-3.5 w-3.5" />{t("mySkills.recovery.cleanup", { defaultValue: "清理旧快照" })}
          </button>
        </div>}
        {loading && snapshots.length === 0 ? <div role="status" className="flex items-center gap-2 py-2 text-[12px] text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t("common.loading")}</div>
          : <div className="max-h-60 overflow-y-auto">
            {snapshots.length === 0 && !error && <p className="py-2 text-[12px] text-muted">{t("mySkills.recovery.empty", { defaultValue: "暂无技能快照，更新或删除技能后会在这里显示。" })}</p>}
            {snapshots.length > 0 && visible.length === 0 && <p className="py-2 text-[12px] text-muted">{t("mySkills.recovery.emptyForSkill", { defaultValue: "该技能暂无快照。" })}</p>}
            {visible.map(snapshot => <div key={snapshot.snapshot_id} className="flex items-center gap-3 border-b border-border-subtle py-2 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-secondary">{snapshot.name}{snapshot.deleted && <span className="ml-2 text-[11px] text-muted">{t("mySkills.recovery.deleted", { defaultValue: "已删除" })}</span>}</div>
                <div className="mt-0.5 text-[11px] text-muted">{reasons[snapshot.reason] || snapshot.reason} · {new Date(snapshot.created_at).toLocaleString(i18n.language)} · {t("mySkills.recovery.files", { count: snapshot.file_count, defaultValue: "{{count}} 个文件" })} · {formatBytes(snapshot.size_bytes)}</div>
              </div>
              <button type="button" onClick={() => setSelected(snapshot)} className="flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[12px] text-secondary outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent">
                <RotateCcw className="h-3.5 w-3.5" />{t("mySkills.recovery.restore", { defaultValue: "恢复" })}
              </button>
            </div>)}
          </div>}
        {result && <div role="status" className="mt-3 rounded border border-border-subtle bg-bg-secondary p-2 text-[12px]">
          <p className="text-secondary">{t("mySkills.recovery.restored", { defaultValue: "技能已恢复" })}</p>
          {result.safety_snapshot_id && <p className="mt-1 text-muted">{t("mySkills.recovery.savedCurrent", { defaultValue: "恢复前的版本已另存为快照，可随时恢复。" })}</p>}
          {result.deployments.map(item => <p key={item.tool} className={`mt-1 ${item.status === "failed" ? "text-amber-600 dark:text-amber-400" : "text-muted"}`}>
            {tools.find(tool => tool.key === item.tool)?.display_name || item.tool}：{item.message}
          </p>)}
        </div>}
      </div>}
      <ConfirmDialog open={selected !== null} title={t("mySkills.recovery.confirmTitle", { defaultValue: "恢复技能快照" })}
        message={t("mySkills.recovery.confirm", { name: selected?.name || "", defaultValue: "恢复「{{name}}」到所选快照？当前版本会另存快照，Agent 副本里的本地改动会保留。" })}
        confirmLabel={t("mySkills.recovery.restore", { defaultValue: "恢复" })} tone="warning" onClose={() => setSelected(null)} onConfirm={restore} />
      <ConfirmDialog open={cleanupPlan !== null} title={t("mySkills.recovery.cleanupTitle", { defaultValue: "清理旧快照" })}
        message={t("mySkills.recovery.cleanupConfirm", {
          defaultValue: "将删除 {{count}} 个旧快照，回收约 {{size}}；每个技能仍保留最近 {{keep}} 个恢复点。",
          count: cleanupPlan?.removable.length ?? 0, size: formatBytes(cleanupPlan?.reclaim_bytes ?? 0), keep: cleanupPlan?.keep_latest ?? keepLatest,
        })}
        details={cleanupPlan?.removable.slice(0, 8).map(item => `${item.name} · ${new Date(item.created_at).toLocaleString(i18n.language)} · ${formatBytes(item.size_bytes)}`)}
        confirmLabel={t("mySkills.recovery.cleanup", { defaultValue: "清理旧快照" })} tone="warning"
        onClose={() => setCleanupPlan(null)} onConfirm={runCleanup} />
    </section>
  );
}
