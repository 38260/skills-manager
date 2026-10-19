import { invoke } from "./transport";

export interface SkillTranslation {
  skill_id: string;
  content: string | null;
  source_hash: string;
  translated_source_hash: string | null;
  revision: string | null;
  updated_at: number | null;
  stale: boolean;
}

export type DocumentLanguage = "zh-CN" | "original";

export const getSkillTranslation = (skillId: string) =>
  invoke<SkillTranslation>("get_skill_translation", { skillId });

export const saveSkillTranslation = (skillId: string, content: string, sourceHash: string, expectedRevision: string | null) =>
  invoke<SkillTranslation>("set_skill_translation", { skillId, content, sourceHash, expectedRevision });

// 默认选中「中文版」：有译文就展示译文，没有译文时正文回落到原文（缺译用角标提示）。
// 只有用户主动点了「英文原文」才切到原文视图，所以这里只看用户的选择，不看译文是否存在。
export function resolveDocumentLanguage(choice: DocumentLanguage | null): DocumentLanguage {
  return choice === "original" ? "original" : "zh-CN";
}
