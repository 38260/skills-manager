import { useTranslation } from "react-i18next";
import { History, RefreshCw } from "lucide-react";
import { cn } from "../utils";
import { toolIconKeys, toolNames, type ActivityEvent, type ActivityStatus } from "../lib/activity";
import { AgentIcon } from "./AgentIcon";

// 列模板：窄窗口只留「技能/项目 + 结果」，≥1024px 展开为五列。
// 表头与数据行共用同一模板，保证逐列对齐（与技能库列表同一约定）。
const GRID = "grid grid-cols-[minmax(0,1fr)_72px] gap-3 lg:grid-cols-[minmax(0,1fr)_84px_100px_76px_96px]";

/** 触发方式徽章：浅色用深色文字、深色用浅色文字，避免只在单一主题下可读。 */
const TRIGGER_TONE: Record<ActivityEvent["trigger"], string> = {
  manual: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  automatic: "border-accent-border bg-accent-bg text-accent-dark dark:text-accent-light",
  unknown: "border-border-subtle bg-surface-hover text-tertiary",
};

/** 结果徽章：已返回 ≠ 任务成功，用中性绿；失败用红；等待/未知用中性。 */
const STATUS_TONE: Record<ActivityStatus, string> = {
  returned: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  failed: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300",
  unknown: "border-border-subtle bg-surface-hover text-tertiary",
};

interface Props {
  items: ActivityEvent[];
  selectedId: string | null;
  onSelect: (record: ActivityEvent) => void;
  loading?: boolean;
  error?: string;
  emptyText?: string;
  onRetry?: () => void;
}

/**
 * 调用记录列表（表格形态）：与参考图一致的五列对齐 + 选中行浅绿底与左侧绿线，
 * 选中项由右侧详情面板呈现，不再就地展开。
 */
export function ActivityTable({ items, selectedId, onSelect, loading, error, emptyText, onRetry }: Props) {
  const { t, i18n } = useTranslation();

  if (loading) {
    return <div className="flex items-center gap-2 py-8 text-[13px] text-tertiary">
      <RefreshCw className="h-4 w-4 animate-spin" />{t("activity.loading")}
    </div>;
  }

  if (error) {
    return <div role="alert" className="flex items-center justify-between gap-3 py-6 text-[13px] text-danger">
      <span>{error}</span>
      {onRetry && <button type="button" onClick={onRetry} className="rounded-md border border-border-subtle px-2.5 py-1 text-[12px] text-secondary outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent">{t("activity.retry")}</button>}
    </div>;
  }

  if (items.length === 0) {
    return <div className="flex flex-col items-center gap-2 py-10 text-center">
      <History className="h-6 w-6 text-muted" />
      <p className="text-[13px] text-secondary">{emptyText ?? t("activity.empty")}</p>
    </div>;
  }

  const time = (value: number | null) => value === null
    ? { day: t("activity.unknownTime"), clock: "" }
    : {
      day: new Date(value).toLocaleDateString(i18n.language, { year: "2-digit", month: "2-digit", day: "2-digit" }),
      clock: new Date(value).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", hour12: false }),
    };

  return (
    <div className="min-w-0">
      {/* 表头 */}
      <div className={cn(GRID, "border-b border-border-subtle border-l-[3px] border-l-transparent px-3 py-2 text-[11.5px] font-medium text-tertiary")} role="presentation">
        <span className="truncate">{t("activity.skill")} / {t("activity.project")}</span>
        <span className="hidden truncate lg:block">{t("activity.agent")}</span>
        <span className="hidden truncate lg:block">{t("activity.kind")} / {t("activity.trigger")}</span>
        <span className="truncate">{t("activity.status")}</span>
        <span className="hidden truncate text-right lg:block">{t("activity.time")}</span>
      </div>

      {items.map(record => {
        const isSelected = record.id === selectedId;
        const stamp = time(record.timestamp);
        return (
          <button
            key={record.id}
            type="button"
            onClick={() => onSelect(record)}
            aria-pressed={isSelected}
            aria-label={t("activity.eventDetails", { skill: record.skillName })}
            className={cn(
              GRID,
              "w-full min-w-0 items-center border-b border-border-subtle border-l-[3px] px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
              isSelected ? "border-l-accent bg-accent-bg" : "border-l-transparent hover:bg-surface-hover"
            )}
          >
            {/* 技能 / 项目 */}
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-accent-bg text-[12px] font-semibold uppercase text-accent-dark dark:text-accent-light">
                {record.skillName.charAt(0)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium leading-5 text-primary" title={record.skillName}>{record.skillName}</span>
                <span className="block truncate text-[11.5px] leading-4 text-tertiary" title={record.project || undefined}>{record.project || t("activity.noProject")}</span>
              </span>
            </span>

            {/* Agent */}
            <span className="hidden min-w-0 items-center gap-1.5 lg:flex">
              <AgentIcon agentKey={toolIconKeys[record.tool] ?? record.tool} displayName={toolNames[record.tool]} className="h-4 w-4 shrink-0" />
              <span className="truncate text-[12px] text-secondary">{toolNames[record.tool]}</span>
            </span>

            {/* 类型 / 触发 */}
            <span className="hidden min-w-0 lg:block">
              <span className="block truncate text-[12px] leading-4 text-secondary">{t(`activity.kinds.${record.kind}`)}</span>
              <span className={cn("mt-0.5 inline-block rounded border px-1.5 py-px text-[10px] leading-4", TRIGGER_TONE[record.trigger])}>
                {t(`activity.triggers.${record.trigger}`)}
              </span>
            </span>

            {/* 结果 */}
            <span className="min-w-0">
              <span className={cn("inline-block rounded border px-1.5 py-px text-[11px] leading-4", STATUS_TONE[record.status])}>
                {t(`activity.statuses.${record.status}`)}
              </span>
            </span>

            {/* 时间 */}
            <span className="hidden text-right text-[11.5px] tabular-nums leading-4 text-tertiary lg:block">
              <span className="block">{stamp.day}</span>
              {stamp.clock && <span className="block">{stamp.clock}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
