import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, History, Loader2, RotateCcw } from "lucide-react";
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

export function SkillRecovery({ refresh }: { refresh: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const { managedSkills, tools } = useApp();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [snapshots, setSnapshots] = useState<SkillSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SkillSnapshot | null>(null);
  const [result, setResult] = useState<RestoreResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSnapshots(await invoke<SkillSnapshot[]>("get_skill_snapshots", {}));
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
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && <div id="skill-recovery-list" aria-busy={loading} className="border-t border-border-subtle px-3 py-3">
        <p className="mb-3 text-[12px] text-muted">{t("mySkills.recovery.hint", { defaultValue: "更新和删除前自动保存技能快照，可恢复单个技能。恢复会保留当前版本，并保护 Agent 副本里的本地改动。" })}</p>
        {error && <div role="alert" className="mb-3 flex items-center gap-2 text-[12px] text-red-500">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => void load()} className="rounded px-2 py-1 text-secondary outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent">{t("common.retry")}</button>
        </div>}
        {loading && snapshots.length === 0 ? <div role="status" className="flex items-center gap-2 py-2 text-[12px] text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t("common.loading")}</div>
          : <div className="max-h-60 overflow-y-auto">
            {snapshots.length === 0 && !error && <p className="py-2 text-[12px] text-muted">{t("mySkills.recovery.empty", { defaultValue: "暂无技能快照，更新或删除技能后会在这里显示。" })}</p>}
            {snapshots.map(snapshot => <div key={snapshot.snapshot_id} className="flex items-center gap-3 border-b border-border-subtle py-2 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-secondary">{snapshot.name}{snapshot.deleted && <span className="ml-2 text-[11px] text-muted">{t("mySkills.recovery.deleted", { defaultValue: "已删除" })}</span>}</div>
                <div className="mt-0.5 text-[11px] text-muted">{reasons[snapshot.reason] || snapshot.reason} · {new Date(snapshot.created_at).toLocaleString(i18n.language)} · {t("mySkills.recovery.files", { count: snapshot.file_count, defaultValue: "{{count}} 个文件" })}</div>
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
    </section>
  );
}
