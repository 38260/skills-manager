import { invoke } from "./transport";

export const activityTools = ["codex", "dsh", "zcode", "qoder", "workbuddy"] as const;
export const toolNames = { codex: "Codex", dsh: "DSH", zcode: "ZCode", qoder: "Qoder", workbuddy: "WorkBuddy" };
export type ActivityTool = typeof activityTools[number];
export type ActivityKind = "invocation" | "document" | "request";
export type ActivityTrigger = "manual" | "automatic" | "unknown";
export interface ActivityEvent {
  id: string; tool: ActivityTool; skillName: string; skillPath: string | null;
  timestamp: number | null; sessionId: string | null; project: string | null; callId: string | null;
  kind: ActivityKind; trigger: ActivityTrigger; status: "pending" | "returned" | "failed" | "unknown";
  evidence: string; sourcePath: string; sourceLine: string; managedSkillId: string | null;
}
export interface ActivityQuery {
  page?: number; pageSize?: number; tool?: ActivityTool | ""; kind?: ActivityKind | "";
  trigger?: ActivityTrigger | ""; skillName?: string; project?: string; from?: number; to?: number;
}
export interface ActivityResult {
  items: ActivityEvent[]; total: number; page: number; pageSize: number;
  counts: Record<ActivityKind | ActivityTrigger, number>;
}
export interface ActivitySource {
  tool: ActivityTool; path: string; enabled: boolean; state: string; lastScan: number | null;
  files: number; processed: number; errors: number; detail: string | null;
}
export const getActivity = (query: ActivityQuery) => invoke<ActivityResult>("get_skill_activity", { ...query });
export const getActivitySources = () => invoke<{ sources: ActivitySource[]; running: boolean }>("get_skill_activity_sources");
export const scanActivity = () => invoke<{ running: boolean }>("scan_skill_activity");
export const cancelActivityScan = () => invoke<{ running: boolean }>("cancel_skill_activity_scan");
export const configureActivitySource = (tool: ActivityTool, path: string, enabled: boolean) => invoke<void>("configure_skill_activity_source", { tool, path, enabled });
