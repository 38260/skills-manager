import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";
import { SkillTranslations } from "../../backend/skill-translations.mjs";
import { hashDirectory } from "../../backend/files.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "data");
const store = new Store({ directory: path.join(root, "app"), home: path.join(root, "home") });
try {
  store.setSetting("language", "zh");
  const library = new Library(store), translations = new SkillTranslations(library);
  const original = "---\nname: bilingual-demo\ndescription: Read the English documentation or its Chinese translation.\n---\n# Bilingual Demo\n\n## When to use\nReview proposed changes before a commit.\n\n## How to use\nGive the AI the files you want to review.\n\n```js\nconst original = true;\n```\n\n" + "Example paragraph for scroll verification.\n\n".repeat(24) + "## Review checklist\nCheck logic and boundary conditions.\n\n## Notes\nKeep the original files unchanged.\n";
  const chinese = "# 双语文档演示\n\n这是用于验收的中文示例，不是对真实技能的翻译。\n\n## 什么时候使用\n提交前审查改动，定位逻辑错误和潜在回归。\n\n## 如何使用\n向 AI 提供需要审查的文件，并说明重点范围。\n\n```js\nconst original = true;\n```\n\n" + "用于验证阅读滚动与目录定位的示例段落。\n\n".repeat(24) + "## 审查重点\n检查逻辑正确性、边界条件和错误处理。\n\n## 注意事项\n保留英文原始文件，中文只用于阅读。\n";
  const manifest = { root, chinese, original, skills: [] };
  for (const name of ["bilingual-demo", "english-only"]) {
    let skill = store.skills().find(item => item.name === name);
    if (!skill) {
      const source = path.join(root, "sources", name);
      fs.mkdirSync(source, { recursive: true });
      fs.writeFileSync(path.join(source, "SKILL.md"), original.replace("name: bilingual-demo", `name: ${name}`));
      skill = await library.installLocal(source);
    }
    if (name === "bilingual-demo" && !translations.get(skill.id).content) {
      const current = translations.get(skill.id);
      translations.save({ skillId: skill.id, content: chinese, sourceHash: current.source_hash, expectedRevision: current.revision });
    }
    manifest.skills.push({ id: skill.id, name, central_path: skill.central_path, original_hash: hashDirectory(skill.central_path) });
  }
  fs.writeFileSync(path.join(root, "fixture.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ directory: store.directory, home: store.home, skills: manifest.skills.map(({ id, name }) => ({ id, name })) }, null, 2));
} finally { store.close(); }
