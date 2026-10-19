import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { inside, readJson, writeJson } from "./files.mjs";

const MAX_CONTENT_BYTES = 4 * 1024 * 1024;
const digest = content => crypto.createHash("sha256").update(content).digest("hex");

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
    if (exists && (saved === null || saved.version !== 1 || typeof saved.content !== "string" || !saved.content.trim()
      || Buffer.byteLength(saved.content, "utf8") > MAX_CONTENT_BYTES
      || typeof saved.source_hash !== "string" || !/^[a-f0-9]{64}$/.test(saved.source_hash)
      || typeof saved.revision !== "string" || !saved.revision || !Number.isFinite(saved.updated_at))) {
      throw new Error("译文文件格式无效，请保留文件并检查内容");
    }
    const sourceHash = digest(document.content);
    return {
      skill_id: skillId, content: saved?.content ?? null, source_hash: sourceHash,
      translated_source_hash: saved?.source_hash ?? null, revision: saved?.revision ?? null,
      updated_at: saved?.updated_at ?? null, stale: saved !== null && saved.source_hash !== sourceHash,
    };
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
    set_skill_translation: { call: args => translations.save(args), mutating: true },
  };
}
