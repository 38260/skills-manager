import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { inside, readJson, writeJson } from "./files.mjs";

const MAX_CONTENT_BYTES = 4 * 1024 * 1024;
const digest = content => crypto.createHash("sha256").update(content).digest("hex");

// 语言判定：去掉 frontmatter、代码块与行内代码后，比较中文字符与拉丁字母的数量。
// 代码块几乎全是英文，不剔除会让「中文文档 + 大段代码」被误判成英文原文。
const FRONTMATTER = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---/;
const CODE_FENCE = /(^|\n)\s*(```|~~~)[\s\S]*?(\n\s*\2|$)/g;
const INLINE_CODE = /`[^`\n]*`/g;
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/g;
const LATIN = /[A-Za-z]/g;
// 本机 56 个技能实测呈明显双峰：英文 ≤0.02，中文 ≥0.25，取 0.2 作为分界。
const CHINESE_RATIO = 0.2;

/** 判断 SKILL.md 主体语言，返回值同时暴露比例，便于排查误判。 */
export function documentLanguage(content) {
  const text = String(content ?? "")
    .replace(FRONTMATTER, "")
    .replace(CODE_FENCE, "\n")
    .replace(INLINE_CODE, " ");
  const cjk = (text.match(CJK) || []).length;
  const latin = (text.match(LATIN) || []).length;
  if (cjk + latin === 0) return { language: "unknown", ratio: 0 };
  const ratio = cjk / (cjk + latin);
  return { language: ratio < CHINESE_RATIO ? "en" : "zh", ratio: Math.round(ratio * 1000) / 1000 };
}

/** 译文文件的结构校验：读取与统计共用同一套规则，避免两处口径漂移。 */
function validSaved(saved) {
  return saved !== null && saved.version === 1 && typeof saved.content === "string" && !!saved.content.trim()
    && Buffer.byteLength(saved.content, "utf8") <= MAX_CONTENT_BYTES
    && typeof saved.source_hash === "string" && /^[a-f0-9]{64}$/.test(saved.source_hash)
    && typeof saved.revision === "string" && !!saved.revision && Number.isFinite(saved.updated_at);
}


// 译文属于管理器元数据，不写入技能目录，也不会作为技能部署给 Agent。
export class SkillTranslations {
  constructor(library) { this.library = library; }

  filename(skillId) {
    return inside(path.join(this.library.store.skillsDirectory, ".skills-manager", "translations"), `${skillId}.zh-CN.json`);
  }

  get(skillId) {
    if (typeof skillId !== "string" || !skillId) throw new Error("缺少技能标识");
    const document = this.library.skillDocument(skillId);
    const filename = this.filename(skillId);
    const exists = fs.existsSync(filename);
    if (exists && fs.statSync(filename).size > MAX_CONTENT_BYTES * 2) throw new Error("译文文件超过读取上限");
    const saved = readJson(filename);
    if (exists && !validSaved(saved)) throw new Error("译文文件格式无效，请保留文件并检查内容");
    const sourceHash = digest(document.content);
    return {
      skill_id: skillId, content: saved?.content ?? null, source_hash: sourceHash,
      translated_source_hash: saved?.source_hash ?? null, revision: saved?.revision ?? null,
      updated_at: saved?.updated_at ?? null, stale: saved !== null && saved.source_hash !== sourceHash,
    };
  }

  // 工作台统计：只把「正文是英文」的技能算进分母，中文原文的技能不需要译本。
  // 逐个技能读一次 SKILL.md（本机 56 个、最大 85 KB，实测整轮 < 20ms），不额外缓存以免读到旧内容。
  coverage() {
    const result = {
      total: 0, english: 0, chinese: 0, unknown: 0,
      translated: 0, missing: 0, stale: 0,
      missing_skills: [], stale_skills: [],
    };
    for (const skill of this.library.store.skills()) {
      result.total++;
      let document;
      try { document = this.library.skillDocument(skill.id); }
      catch { result.unknown++; continue; }
      const { language } = documentLanguage(document.content);
      if (language !== "en") { result[language === "zh" ? "chinese" : "unknown"]++; continue; }
      result.english++;
      const entry = { id: skill.id, name: skill.name };
      const filename = this.filename(skill.id);
      let saved = null;
      if (fs.existsSync(filename)) { try { saved = readJson(filename); } catch { saved = null; } }
      if (!validSaved(saved)) { result.missing++; result.missing_skills.push(entry); continue; }
      if (saved.source_hash === digest(document.content)) result.translated++;
      else { result.stale++; result.stale_skills.push(entry); }
    }
    return result;
  }

  save({ skillId, content, sourceHash, expectedRevision }) {
    if (typeof content !== "string" || !content.trim()) throw new Error("中文版不能为空");
    if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) throw new Error("中文版超过 4 MiB 上限");
    const current = this.get(skillId);
    if (sourceHash !== current.source_hash) throw new Error("英文原文已变化，请重新读取原文并核对译文后保存");
    if (expectedRevision !== current.revision) throw new Error("中文版已被其他窗口修改，请重新读取后合并内容");
    const saved = { version: 1, content, source_hash: sourceHash, revision: crypto.randomUUID(), updated_at: Date.now() };
    writeJson(this.filename(skillId), saved);
    return { ...current, content, translated_source_hash: sourceHash, revision: saved.revision, updated_at: saved.updated_at, stale: false };
  }
}

export function skillTranslationCommands(library) {
  const translations = new SkillTranslations(library);
  return {
    get_skill_translation: { call: args => translations.get(args.skillId) },
    get_translation_coverage: { call: () => translations.coverage() },
    set_skill_translation: { call: args => translations.save(args), mutating: true },
  };
}
