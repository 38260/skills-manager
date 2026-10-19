import { useTranslation } from "react-i18next";
import { History, RefreshCw } from "lucide-react";
import { cn } from "../utils";
import { toolIconKeys, toolNames, type ActivityEvent } from "../lib/activity";
import { KIND_TONE, STATUS_TONE, TRIGGER_TONE } from "../lib/activityTone";
import { AgentIcon } from "./AgentIcon";

// 列模板：<1280px 只留「技能/项目 + 结果」；≥1280px 展开五列（记录类型与触发方式各占一列，
// Agent 让位）；≥1536px 再加回 Agent。表头与数据行共用同一模板，保证逐列对齐（与技能库列表同一约定）。
// 断点定在 1280 而非 1024：1024–1280 这一段外层已经并排（详情栏占 380px），
// 列表只剩五六百像素，再摊开列会被挤扁 —— 这一档保持两列更可读。
// ≥1800px 单独一档：外层再宽时多出来的空间全部灌进技能列会让它占到一半（实测 1920 下 543/1062），
// 名字只有几十像素却留出大片空白。这一档把余量分给 Agent/结果/时间，技能列回落到四成左右。
const GRID = "grid grid-cols-[minmax(0,1fr)_72px] gap-3 xl:grid-cols-[minmax(0,1fr)_100px_76px_76px_96px] 2xl:grid-cols-[minmax(0,1fr)_104px_100px_76px_76px_96px] min-[1800px]:grid-cols-[minmax(0,1fr)_124px_116px_88px_84px_120px]";

// 徽章底色见 lib/activityTone.ts（记录类型 / 触发方式 / 结果三类各自的色系）。

interface Props {
  items: ActivityEvent[];
  selectedId: string | null;
  onSelect: (record: ActivityEvent) => void;
  /** 技能名是独立入口：命中技能库时直接打开技能详情，不再只是选中行。 */
  onOpenSkill?: (managedSkillId: string) => void;
  loading?: boolean;
  error?: string;
  emptyText?: string;
  onRetry?: () => void;
}

/**
 * 调用记录列表（表格形态）：与参考图一致的五列对齐 + 选中行浅绿底与左侧绿线，
 * 选中项由右侧详情面板呈现，不再就地展开。
 */
export function ActivityTable({ items, selectedId, onSelect, onOpenSkill, loading, error, emptyText, onRetry }: Props) {
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
      {/* 表头在列表自身滚动时吸顶，长列表也能对上列 */}
      <div className={cn(GRID, "sticky top-0 z-[1] border-b border-border-subtle border-l-[3px] border-l-transparent bg-surface px-3 py-2 text-[11.5px] font-medium text-tertiary")} role="presentation">
        <span className="truncate">{t("activity.skill")} / {t("activity.project")}</span>
        <span className="hidden truncate 2xl:block">{t("activity.agent")}</span>
        <span className="hidden truncate xl:block">{t("activity.kind")}</span>
        <span className="hidden truncate xl:block">{t("activity.trigger")}</span>
        <span className="truncate">{t("activity.status")}</span>
        <span className="hidden truncate text-right xl:block">{t("activity.time")}</span>
      </div>

      {items.map(record => {
        const isSelected = record.id === selectedId;
        const stamp = time(record.timestamp);
        const skillId = record.managedSkillId ?? record.usageSkillId ?? null;
        return (
          <div
            key={record.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(record)}
            onKeyDown={event => {
              // 技能名按钮自己处理键盘事件，避免同时选中行。
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(record); }
            }}
            aria-pressed={isSelected}
            aria-label={t("activity.eventDetails", { skill: record.skillName })}
            className={cn(
              GRID,
              "w-full min-w-0 cursor-pointer items-center border-b border-border-subtle border-l-[3px] px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
              isSelected ? "border-l-accent bg-accent-bg" : "border-l-transparent hover:bg-surface-hover"
            )}
          >
            {/* 技能 / 项目 */}
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-accent-bg text-[12px] font-semibold uppercase text-accent-dark dark:text-accent-light">
                {record.skillName.charAt(0)}
              </span>
              <span className="min-w-0">
                {skillId && onOpenSkill ? (
                  <button
                    type="button"
                    onClick={event => { event.stopPropagation(); onOpenSkill(skillId); }}
                    className="block max-w-full cursor-pointer truncate rounded text-left text-[13px] font-medium leading-5 text-accent-dark underline decoration-accent/40 underline-offset-2 outline-none hover:decoration-current focus-visible:ring-2 focus-visible:ring-accent dark:text-accent-light"
                    title={record.managedSkillId ? t("activity.openSkill") : t("activity.openSkillByNameHint")}
                    aria-label={`${record.skillName} · ${t("activity.openSkill")}`}
                  >
                    {record.skillName}
                  </button>
                ) : (
                  <span className="block truncate text-[13px] font-medium leading-5 text-primary" title={`${record.skillName} · ${t("activity.unlinked")}`}>{record.skillName}</span>
                )}
                <span className="block truncate text-[11.5px] leading-4 text-tertiary" title={record.project || undefined}>{record.project || t("activity.noProject")}</span>
              </span>
            </span>

            {/* Agent */}
            <span className="hidden min-w-0 items-center gap-1.5 2xl:flex">
              <AgentIcon agentKey={toolIconKeys[record.tool] ?? record.tool} displayName={toolNames[record.tool]} className="h-4 w-4 shrink-0" />
              <span className="truncate text-[12px] text-secondary">{toolNames[record.tool]}</span>
            </span>

            {/* 记录类型 / 触发方式：各占一列，扫一眼就能区分「明确调用 / 已确认加载 / 仅请求」
                与「用户点名 / Agent 自选」 */}
            <span className="hidden min-w-0 xl:block">
              <span className={cn("inline-block max-w-full truncate rounded border px-1.5 py-px text-[10px] leading-4", KIND_TONE[record.kind])}>
                {t(`activity.kinds.${record.kind}`)}
              </span>
            </span>
            <span className="hidden min-w-0 xl:block">
              <span className={cn("inline-block max-w-full truncate rounded border px-1.5 py-px text-[10px] leading-4", TRIGGER_TONE[record.trigger])}>
                {t(`activity.triggers.${record.trigger}`)}
              </span>
            </span>

            {/* 结果 */}
            <span className="min-w-0">
              <span className={cn("inline-block rounded border px-1.5 py-px text-[11px] leading-4", STATUS_TONE[record.status])}>
                {t(`activity.statuses.${record.status}`)}
              </span>
            </span>

            {/* 时间：日期与时分同一行 */}
            <span className="hidden whitespace-nowrap text-right text-[11.5px] tabular-nums leading-4 text-tertiary xl:block">
              {stamp.day}{stamp.clock && ` ${stamp.clock}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
