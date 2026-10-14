import type { ManagedSkill } from "./tauri";

type SearchableSkill = Pick<ManagedSkill, "name" | "description" | "alias" | "custom_description" | "display_name" | "display_description" | "central_path">;
export type SkillSearchField = "alias" | "name" | "directory" | "customDescription" | "description";
export interface SkillSearchMatch {
  field: SkillSearchField | null;
  value: string;
}

function directoryName(skill: SearchableSkill) {
  return skill.central_path.split(/[\\/]/).filter(Boolean).pop() || skill.name;
}

export function getSkillDisplayNames(skills: (SearchableSkill & { id: string })[]) {
  const counts = new Map<string, number>();
  for (const skill of skills) counts.set(skill.name, (counts.get(skill.name) ?? 0) + 1);
  const names = new Map<string, string>();
  for (const skill of skills) {
    const alias = skill.alias?.trim() || (skill.display_name !== skill.name ? skill.display_name?.trim() : "");
    const directory = directoryName(skill);
    // 与技能库现有规则一致：别名优先，同名技能用中央目录名区分。
    names.set(skill.id, alias || ((counts.get(skill.name) ?? 0) > 1 && directory !== skill.name ? directory : skill.name));
  }
  return names;
}

export function matchSkillSearch(skill: SearchableSkill, query: string, displayName?: string): SkillSearchMatch | null {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return { field: null, value: "" };
  const alias = skill.alias?.trim() || (skill.display_name !== skill.name ? skill.display_name?.trim() : "");
  const directory = directoryName(skill);
  const candidates: [SkillSearchField, string | null | undefined][] = [
    ["alias", alias],
    ["name", skill.name],
    ["directory", directory],
    [displayName === alias ? "alias" : "directory", displayName],
    ["customDescription", skill.custom_description],
    ["description", skill.description],
    [skill.display_description && skill.display_description !== skill.description ? "customDescription" : "description", skill.display_description],
  ];
  for (const [field, value] of candidates) {
    if (value?.toLowerCase().includes(normalizedQuery)) return { field, value };
  }
  return null;
}
