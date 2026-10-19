import type { ManagedSkill } from "./tauri";

type SearchableSkill = Pick<ManagedSkill, "name" | "description" | "alias" | "custom_description" | "display_name" | "display_description" | "central_path">;
export type SkillSearchField = "alias" | "name" | "directory" | "customDescription" | "description";
export interface SkillSearchMatch {
  field: SkillSearchField | null;
  value: string;
  /** 命中片段在 value 里的起始下标；无搜索词时为 -1。用于把命中处前后的文字截出来展示。 */
  index: number;
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
  if (!normalizedQuery) return { field: null, value: "", index: -1 };
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
    const index = value ? value.toLowerCase().indexOf(normalizedQuery) : -1;
    if (index >= 0) return { field, value: value as string, index };
  }
  return null;
}

/**
 * 搜索命中处前后的文字片段。长描述命中时整段从头显示会把高亮顶到看不见的地方
 * （实测「git」命中到描述第 112/136 字），所以只截命中处前后一段并加省略号。
 */
export function matchSnippet(match: SkillSearchMatch, query: string, before = 24, after = 56): string {
  const term = query.trim();
  const value = match.value ?? "";
  if (!term || match.index < 0) return value;
  const start = Math.max(0, match.index - before);
  const end = Math.min(value.length, match.index + term.length + after);
  return `${start > 0 ? "…" : ""}${value.slice(start, end)}${end < value.length ? "…" : ""}`;
}
