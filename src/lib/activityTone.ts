import type { ActivityEvent, ActivityStatus } from "./activity";

/**
 * 调用记录的彩色徽章：记录类型 / 触发方式 / 结果。
 * 三类各用不同色系，避免整列都是灰字（此前「记录类型」是无底色的灰色文本，
 * 「触发方式」虽有色但很淡，扫一眼分不出差别）。
 * 浅色用 700 级文字、深色用 300 级，保证两种主题下都能读；改配色请跑
 * `node output/activity-fix/check-chip-contrast.mjs` 复核对比度（正文要求 ≥4.5）。
 */
export type ActivityKind = ActivityEvent["kind"];

/** 记录类型：明确调用 / 已确认加载 / 仅请求（待确认）。 */
export const KIND_TONE: Record<ActivityKind, string> = {
  invocation: "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  document: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  request: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

/** 触发方式：手动（用户点名）/ 自动（Agent 自选）/ 来源未知（日志里没有用户上下文）。 */
export const TRIGGER_TONE: Record<ActivityEvent["trigger"], string> = {
  manual: "border-accent-border bg-accent-bg text-accent-dark dark:text-accent-light",
  automatic: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  unknown: "border-border-subtle bg-surface-hover text-tertiary",
};

/** 结果：已返回 ≠ 任务成功，用中性绿；失败用红；等待/未知用中性。 */
export const STATUS_TONE: Record<ActivityStatus, string> = {
  returned: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  failed: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  unknown: "border-border-subtle bg-surface-hover text-tertiary",
};
