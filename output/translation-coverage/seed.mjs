// 「中文译本」统计卡的验收用隔离数据。
// 目标现场：4 个英文原文（1 已译 / 2 缺译 / 1 译文对应旧原文）、2 个中文原文（不计入分母）。
// 只写入 output/translation-coverage/data/<run>，不接触用户真实技能库。
import fs from "node:fs";
import path from "node:path";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";
import { SkillTranslations } from "../../backend/skill-translations.mjs";

// 每轮新建独立目录：本机 Node 的 rmSync 会转回收站并失败，不能靠删除旧数据。
const root = path.resolve(process.env.TRANSLATION_COVERAGE_DATA ?? path.join("output/translation-coverage/data", `run-${Date.now()}`));
const home = path.join(root, "home");
fs.mkdirSync(home, { recursive: true });

// 让工作台检测到若干 Agent，避免「已启用 Agent」卡片影响布局比对。
for (const tool of [".codex", ".claude"]) fs.mkdirSync(path.join(home, tool), { recursive: true });

const store = new Store({ directory: path.join(home, ".skills-manager"), home });
store.setSetting("backup_auto_enabled", "off");
store.setSetting("backup_first_run_prompt", "fresh");
store.setSetting("sync_mode", "copy");

const ENGLISH = [
  "---\nname: NAME\ndescription: English skill used by the translation coverage fixture.\n---",
  "# NAME",
  "## When to use",
  "Use this skill when the reviewer needs a deterministic checklist.",
  "## Steps",
  "Read the target file, then run the verifier and paste the summary.",
].join("\n");

const CHINESE = [
  "---\nname: NAME\ndescription: 中文原文技能，用于验证译本统计不计入分母。\n---",
  "# NAME",
  "## 何时使用",
  "当审阅者需要一份确定性的检查清单时使用本技能。",
  "## 步骤",
  "先读目标文件，再跑一遍校验脚本，最后把结论贴回来。",
  "```bash",
  "node scripts/verify.mjs --port 14500 --profile /tmp/profile",
  "```",
].join("\n");

const SKILLS = [
  // [目录名, 正文模板, 是否保存译文, 保存后是否改动原文（造 stale）]
  ["en-done", ENGLISH, true, false],
  ["en-missing-alpha", ENGLISH, false, false],
  ["en-missing-beta-with-long-name", ENGLISH, false, false],
  ["en-stale", ENGLISH, true, true],
  ["zh-native", CHINESE, false, false],
  ["zh-native-with-code", CHINESE, false, false],
];

const upstream = path.join(root, "upstream");
const library = new Library(store);
const translations = new SkillTranslations(library);

for (const [name, template, withTranslation, thenChange] of SKILLS) {
  const dir = path.join(upstream, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), template.replaceAll("NAME", name));
  const skill = await library.installLocal(dir);
  // 名单里优先展示别名，验证统计卡走的是同一套显示名口径。
  if (name === "en-missing-alpha") store.setProfile(skill.id, { alias: "待译样例", customDescription: null, authorOverride: null, icon: null });
  if (!withTranslation) continue;
  const current = translations.get(skill.id);
  translations.save({
    skillId: skill.id,
    content: `# ${name}\n\n## 何时使用\n\n审阅者需要一份确定性的检查清单时使用。\n`,
    sourceHash: current.source_hash,
    expectedRevision: null,
  });
  if (thenChange) fs.appendFileSync(path.join(skill.central_path, "SKILL.md"), "\n## 追加章节\n\n原文后来改过。\n");
}

const coverage = translations.coverage();
console.log(`seeded: total=${coverage.total} english=${coverage.english} chinese=${coverage.chinese} translated=${coverage.translated} missing=${coverage.missing} stale=${coverage.stale}`);
