import type { DiscoveredGroup, DiscoveredLocation } from "./tauri";

export const LOCAL_DISCOVERY_INTERVAL_MS = 60_000;
export const LOCAL_DISCOVERY_COOLDOWN_MS = 30_000;
export const LOCAL_DISCOVERY_NOTIFIED_SETTING = "local_discovery_notified_paths";

export type DiscoveryTrigger = "startup" | "focus" | "visibility" | "interval" | "manual";

export function locationKey(location: DiscoveredLocation): string {
  return location.key || `path:${location.found_path}`;
}

export function groupLocationKeys(group: DiscoveredGroup): string[] {
  return group.locations.map(locationKey);
}

export function pendingGroups(groups: readonly DiscoveredGroup[]): DiscoveredGroup[] {
  return groups.filter(group => !group.imported);
}

/** 候选身份按路径而不是数据库 UUID/内容指纹判断：内容变化不会重新提示，群组合并/拆分也不会误报。 */
export function newPendingGroups(
  groups: readonly DiscoveredGroup[],
  notified: ReadonlySet<string>
): DiscoveredGroup[] {
  return pendingGroups(groups).filter(group =>
    !groupLocationKeys(group).some(key => notified.has(key))
  );
}

export function collectCandidateKeys(groups: readonly DiscoveredGroup[]): string[] {
  const keys = new Set<string>();
  for (const group of groups) {
    for (const key of groupLocationKeys(group)) keys.add(key);
  }
  return [...keys];
}

/** null 表示从未保存过去重状态（首次成功扫描）；损坏的值也按首次处理并会在下次扫描后覆盖。 */
export function parseNotifiedKeys(value: string | null): Set<string> | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.filter((item): item is string => typeof item === "string" && item.length > 0));
  } catch {
    return null;
  }
}

export function mergeNotifiedKeys(
  previous: Iterable<string>,
  groups: readonly DiscoveredGroup[]
): Set<string> {
  const next = new Set(previous);
  for (const key of collectCandidateKeys(groups)) next.add(key);
  return next;
}

export type DiscoveryRequestReason = "started" | "cooldown" | "in-flight";

export interface DiscoveryRequest {
  trigger: DiscoveryTrigger;
  started: boolean;
  reason: DiscoveryRequestReason;
  promise: Promise<unknown> | null;
}

interface CoordinatorOptions {
  run: (trigger: DiscoveryTrigger) => Promise<unknown>;
  now?: () => number;
  cooldownMs?: number;
}

/**
 * 所有扫描请求先经过这里：同一时刻只有一个任务；自动触发（含启动）受冷却限制，
 * 手动请求绕过冷却，但仍在任务执行中复用同一个 Promise。
 */
export class LocalDiscoveryCoordinator {
  private readonly run: (trigger: DiscoveryTrigger) => Promise<unknown>;
  private readonly now: () => number;
  private readonly cooldownMs: number;
  private inFlight: Promise<unknown> | null = null;
  private lastStartedAt: number | null = null;

  constructor(options: CoordinatorOptions) {
    this.run = options.run;
    this.now = options.now ?? Date.now;
    this.cooldownMs = options.cooldownMs ?? LOCAL_DISCOVERY_COOLDOWN_MS;
  }

  get scanning(): boolean {
    return this.inFlight !== null;
  }

  request(trigger: DiscoveryTrigger): DiscoveryRequest {
    if (this.inFlight) {
      return { trigger, started: false, reason: "in-flight", promise: this.inFlight };
    }
    const now = this.now();
    const bypassCooldown = trigger === "manual";
    if (!bypassCooldown && this.lastStartedAt !== null && now - this.lastStartedAt < this.cooldownMs) {
      return { trigger, started: false, reason: "cooldown", promise: null };
    }
    this.lastStartedAt = now;
    const promise = Promise.resolve()
      .then(() => this.run(trigger))
      .finally(() => {
        if (this.inFlight === promise) this.inFlight = null;
      });
    this.inFlight = promise;
    return { trigger, started: true, reason: "started", promise };
  }

  async waitForIdle(): Promise<void> {
    const current = this.inFlight;
    if (!current) return;
    try { await current; } catch { /* 失败由发起该任务的调用方反馈 */ }
  }
}
