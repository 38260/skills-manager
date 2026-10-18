import type { ManagedSkill } from "./tauri";
import type { SkillUsage } from "./activity";

export type LibrarySortMode = "default" | "usage-desc" | "usage-asc";

export function sortLibrarySkills<T extends Pick<ManagedSkill, "id" | "name" | "preset_ids">>(
  skills: T[],
  mode: LibrarySortMode,
  usage: Record<string, SkillUsage>,
  presetId: string | null,
  presetSkillOrder: string[],
): T[] {
  return [...skills].sort((a, b) => {
    if (mode !== "default") {
      const difference = (usage[a.id]?.count ?? 0) - (usage[b.id]?.count ?? 0);
      if (difference) return mode === "usage-asc" ? difference : -difference;
    }
    // 次数相同时沿用原顺序；默认模式保留预设启用分组与手动顺序。
    if (!presetId) return 0;
    const enabledDifference = Number(!a.preset_ids.includes(presetId)) - Number(!b.preset_ids.includes(presetId));
    if (enabledDifference) return enabledDifference;
    const aOrder = presetSkillOrder.indexOf(a.id);
    const bOrder = presetSkillOrder.indexOf(b.id);
    if (aOrder !== -1 && bOrder !== -1) return aOrder - bOrder;
    if (aOrder !== -1) return -1;
    if (bOrder !== -1) return 1;
    return a.name.localeCompare(b.name);
  });
}
