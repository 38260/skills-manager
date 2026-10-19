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

// 每次打开优先中文；缺失或读取失败时展示已有原文，绝不把原文标成中文。
export function resolveDocumentLanguage(choice: DocumentLanguage | null, translation: SkillTranslation | null): DocumentLanguage {
  return choice !== "original" && translation?.content ? "zh-CN" : "original";
}
