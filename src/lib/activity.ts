import { invoke } from "./transport";

export const activityTools = ["codex", "dsh", "zcode", "qoder", "workbuddy", "workbuddy_ai"] as const;
export const toolNames = { codex: "Codex", dsh: "DSH", zcode: "ZCode", qoder: "Qoder", workbuddy: "WorkBuddy", workbuddy_ai: "WorkBuddy AI" };
/** 调用记录的工具标识到 Agent 图标键的映射：DSH 的图标键是 deepseek_harness；WorkBuddy AI 复用 WorkBuddy 的图标。 */
export const toolIconKeys: Record<string, string> = {
  codex: "codex", dsh: "deepseek_harness", zcode: "zcode", qoder: "qoder", workbuddy: "workbuddy", workbuddy_ai: "workbuddy",
};
export type ActivityTool = typeof activityTools[number];
export type ActivityKind = "invocation" | "document" | "request";
export type ActivityTrigger = "manual" | "automatic" | "unknown";
export type ActivityStatus = "pending" | "returned" | "failed" | "unknown";
export interface ActivityEvent {
  id: string; tool: ActivityTool; skillName: string; skillPath: string | null;
  timestamp: number | null; sessionId: string | null; project: string | null; callId: string | null;
  kind: ActivityKind; trigger: ActivityTrigger; status: ActivityStatus;
  evidence: string; sourcePath: string; sourceLine: string; managedSkillId: string | null;
  /** 严格匹配失败、但技能名在技能库中唯一时的兜底归属（界面会标注「按技能名匹配」）。 */
  usageSkillId?: string | null;
}
export interface ActivityQuery {
  page?: number; pageSize?: number; tool?: ActivityTool | ""; kind?: ActivityKind | "";
  trigger?: ActivityTrigger | ""; status?: ActivityStatus | "";
  skillName?: string; project?: string; from?: number; to?: number;
}
export interface ActivityResult {
  items: ActivityEvent[]; total: number; page: number; pageSize: number;
  counts: Record<ActivityKind | ActivityTrigger, number>;
}
export interface ActivitySource {
  tool: ActivityTool; path: string; enabled: boolean; state: string; lastScan: number | null;
  files: number; processed: number; errors: number; detail: string | null;
}
export interface ActivityExcerpt {
  available: boolean;
  reason?: "missing" | "not_found" | "unreadable";
  detail?: string;
  kind: "jsonl" | "zstd" | "zcode";
  lineKind: "line" | "part";
  sourcePath: string;
  sourceLine: string;
  /** 高亮行：普通日志是行号，ZCode 是 part:<id>。 */
  focus: string;
  lines: { label: string; text: string }[];
  truncated: boolean;
}
export const getActivity = (query: ActivityQuery) => invoke<ActivityResult>("get_skill_activity", { ...query });
export const getActivityExcerpt = (id: string) => invoke<ActivityExcerpt>("get_skill_activity_excerpt", { id });
export const getActivitySources = () => invoke<{ sources: ActivitySource[]; running: boolean }>("get_skill_activity_sources");
export const scanActivity = () => invoke<{ running: boolean }>("scan_skill_activity");
export const cancelActivityScan = () => invoke<{ running: boolean }>("cancel_skill_activity_scan");
export const configureActivitySource = (tool: ActivityTool, path: string, enabled: boolean) => invoke<void>("configure_skill_activity_source", { tool, path, enabled });

export interface SkillUsage {
  count: number;
  lastUsedAt: number | null;
}
/** 已纳管技能的调用统计：技能 id → 总次数与最后使用时间；从未使用的技能不出现在结果里。 */
export const getSkillUsage = () => invoke<Record<string, SkillUsage>>("get_skill_usage");
