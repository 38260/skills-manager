import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, FileSearch, FolderSearch, History, RefreshCw } from "lucide-react";
import { cn } from "../utils";
import { openPath } from "../lib/tauri";
import { toolNames, type ActivityEvent } from "../lib/activity";

const TRIGGER_TONE: Record<ActivityEvent["trigger"], string> = {
  manual: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300",
  automatic: "border-accent-border bg-accent-bg text-accent-dark dark:text-accent-light",
  unknown: "border-border-subtle bg-surface-hover text-tertiary",
};

interface Props {
  items: ActivityEvent[];
  loading?: boolean;
  error?: string;
  /** 详情页内嵌时隐藏"打开技能"入口，并压缩次要列。 */
  compact?: boolean;
  emptyText?: string;
  onOpenSkill?: (managedSkillId: string) => void;
  onRetry?: () => void;
  className?: string;
}

/**
 * 调用记录列表：按参考图的平面分组样式渲染——不使用大圆角卡片，
 * 依靠细分隔线、绿色强调色和两行信息层级区分记录，展开后展示可追溯的定位信息。
 */
export function ActivityRecordList({ items, loading, error, compact = false, emptyText, onOpenSkill, onRetry, className }: Props) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [openError, setOpenError] = useState("");
  const date = (value: number | null) => value === null ? t("activity.unknownTime") : new Date(value).toLocaleString(i18n.language);

  async function revealFile(path: string) {
    setOpenError("");
    try { await openPath(path, true); }
    catch (cause) { setOpenError(String(cause instanceof Error ? cause.message : cause)); }
  }

  if (loading) {
    return <div className={cn("flex items-center gap-2 py-8 text-[13px] text-tertiary", className)}>
      <RefreshCw className="h-4 w-4 animate-spin" />{t("activity.loading")}
    </div>;
  }

  if (error) {
    return <div role="alert" className={cn("flex items-center justify-between gap-3 py-6 text-[13px] text-danger", className)}>
      <span>{error}</span>
      {onRetry && <button type="button" onClick={onRetry} className="rounded-md border border-border-subtle px-2.5 py-1 text-[12px] text-secondary outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent">{t("activity.retry")}</button>}
    </div>;
  }

  if (items.length === 0) {
    return <div className={cn("flex flex-col items-center gap-2 py-10 text-center", className)}>
      <History className="h-6 w-6 text-muted" />
      <p className="text-[13px] text-secondary">{emptyText ?? t("activity.empty")}</p>
    </div>;
  }

  return (
    <div className={cn("flex flex-col", className)}>
      {openError && <p role="alert" className="border-b border-border-subtle py-2 text-[12px] text-danger">{openError}</p>}
      {items.map(record => {
        const isOpen = expanded === record.id;
        return (
          <Fragment key={record.id}>
            <button
              type="button"
              onClick={() => setExpanded(isOpen ? null : record.id)}
              aria-expanded={isOpen}
              aria-controls={`event-${record.id}`}
              className="flex min-w-0 items-start gap-3 border-b border-border-subtle px-1 py-2.5 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
            >
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 truncate text-[14px] font-medium leading-5 text-primary" title={record.skillName}>{record.skillName}</span>
                  <span className="rounded-md border border-border-subtle px-1.5 py-px text-[11px] leading-4 text-tertiary">{toolNames[record.tool]}</span>
                  <span className={cn("rounded-md border px-1.5 py-px text-[11px] leading-4", TRIGGER_TONE[record.trigger])}>{t(`activity.triggers.${record.trigger}`)}</span>
                  {record.status === "failed" && <span className="text-[11px] leading-4 text-danger">{t("activity.statuses.failed")}</span>}
                </div>
                <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-[12px] leading-4 text-tertiary">
                  <span className="truncate" title={record.project || ""}>{record.project || t("activity.noProject")}</span>
                  <span className="text-faint">·</span>
                  <span>{t(`activity.kinds.${record.kind}`)}</span>
                  {!compact && <><span className="text-faint">·</span><span>{t(`activity.evidenceCodes.${record.evidence}`, { defaultValue: record.evidence })}</span></>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 pt-0.5">
                <span className="hidden whitespace-nowrap text-[12px] tabular-nums text-muted sm:inline">{date(record.timestamp)}</span>
                <ChevronDown className={cn("h-4 w-4 text-muted transition-transform", isOpen && "rotate-180")} />
              </div>
            </button>
            {isOpen && (
              <div id={`event-${record.id}`} className="border-b border-border-subtle bg-bg-secondary/60 px-3 py-3">
                <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-[12px]">
                  {([
                    ["evidence", t(`activity.evidenceCodes.${record.evidence}`, { defaultValue: record.evidence })],
                    ["position", record.sourceLine],
                    ["session", record.sessionId],
                    ["call", record.callId],
                    ["project", record.project],
                    ["skillPath", record.skillPath],
                  ] as [string, string | null][]).map(([key, value]) => (
                    <Fragment key={key}>
                      <dt className="whitespace-nowrap text-tertiary">{t(`activity.${key}`)}</dt>
                      <dd className="min-w-0 break-all text-secondary">{value || "—"}</dd>
                    </Fragment>
                  ))}
                  <dt className="whitespace-nowrap text-tertiary">{t("activity.sourceFile")}</dt>
                  <dd className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="min-w-0 break-all text-secondary">{record.sourcePath || "—"}</span>
                    {record.sourcePath && (
                      <button type="button" onClick={() => void revealFile(record.sourcePath)}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border-subtle px-2 py-0.5 text-[11.5px] text-secondary outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent">
                        <FolderSearch className="h-3.5 w-3.5" />{t("mySkills.detail.revealInFolder")}
                      </button>
                    )}
                  </dd>
                </dl>
                <p className="mt-2.5 text-[12px] text-tertiary">{t("activity.statusNote")}</p>
                {!compact && (record.managedSkillId && onOpenSkill ? (
                  <button type="button" onClick={() => onOpenSkill(record.managedSkillId!)}
                    className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent-bg px-2.5 py-1 text-[12px] text-accent-dark outline-none hover:bg-accent-bg focus-visible:ring-2 focus-visible:ring-accent dark:text-accent-light">
                    <FileSearch className="h-3.5 w-3.5" />{t("activity.openSkill")}
                  </button>
                ) : <p className="mt-2.5 text-[12px] text-tertiary">{t("activity.unlinked")}</p>)}
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
