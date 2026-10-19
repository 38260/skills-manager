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

export interface TranslationCoverageSkill {
  id: string;
  name: string;
}

/** 工作台的译本覆盖：分母只含「正文是英文」的技能，中文原文的不需要译本。 */
export interface TranslationCoverage {
  total: number;
  english: number;
  chinese: number;
  unknown: number;
  translated: number;
  missing: number;
  stale: number;
  missing_skills: TranslationCoverageSkill[];
  stale_skills: TranslationCoverageSkill[];
}

export const getSkillTranslation = (skillId: string) =>
  invoke<SkillTranslation>("get_skill_translation", { skillId });

export const getTranslationCoverage = () =>
  invoke<TranslationCoverage>("get_translation_coverage");

export const saveSkillTranslation = (skillId: string, content: string, sourceHash: string, expectedRevision: string | null) =>
  invoke<SkillTranslation>("set_skill_translation", { skillId, content, sourceHash, expectedRevision });

// 默认选中「中文版」：有译文就展示译文，没有译文时正文回落到原文。
// 只有用户主动点了「English」才切到原文视图，所以这里只看用户的选择，不看译文是否存在。
export function resolveDocumentLanguage(choice: DocumentLanguage | null): DocumentLanguage {
  return choice === "original" ? "original" : "zh-CN";
}

// 正文语言判定：与 backend/skill-translations.mjs 的 documentLanguage 完全同口径
// （去掉 frontmatter、围栏代码与行内代码后比较中文字符与拉丁字母，阈值 0.2；
// 两个实现由 tests/ui/skill-translation-render.test.mjs 交叉校验，避免漂移）。
// 前端用它区分「英文原文还没有中文版」与「正文本来就是中文」——后者不需要译本，不该提示缺译。
const FRONTMATTER = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---/;
const CODE_FENCE = /(^|\n)\s*(```|~~~)[\s\S]*?(\n\s*\2|$)/g;
const INLINE_CODE = /`[^`\n]*`/g;
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/g;
const LATIN = /[A-Za-z]/g;
const CHINESE_RATIO = 0.2;

export type DocumentSourceLanguage = "en" | "zh" | "unknown";

export function documentSourceLanguage(content: string): DocumentSourceLanguage {
  const text = String(content ?? "")
    .replace(FRONTMATTER, "")
    .replace(CODE_FENCE, "\n")
    .replace(INLINE_CODE, " ");
  const cjk = (text.match(CJK) ?? []).length;
  const latin = (text.match(LATIN) ?? []).length;
  if (cjk + latin === 0) return "unknown";
  return cjk / (cjk + latin) < CHINESE_RATIO ? "en" : "zh";
}
