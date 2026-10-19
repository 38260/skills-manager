import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";
import { SkillTranslations, documentLanguage, skillTranslationCommands } from "../../backend/skill-translations.mjs";

const ENGLISH = "---\nname: NAME\n---\n# NAME\n\n## Usage\n\nRead the file, then run the checks. Nothing else.\n";
const CHINESE = "---\nname: NAME\n---\n# NAME\n\n## 使用方法\n\n先读文件，再跑检查，不要做别的事情。\n";

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manager-coverage-test-"));
  const store = new Store({ directory: path.join(root, "app"), home: root });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true }); });
  const library = new Library(store);
  const translations = new SkillTranslations(library);
  const counter = { value: 0 };

  async function add(body) {
    counter.value += 1;
    const name = `case-${counter.value}`;
    const source = path.join(root, `source-${counter.value}`);
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, "SKILL.md"), body.replaceAll("NAME", name));
    return library.installLocal(source);
  }
  async function translate(skill) {
    const current = translations.get(skill.id);
    return translations.save({ skillId: skill.id, content: "# 中文版本\n\n读这里。\n", sourceHash: current.source_hash, expectedRevision: null });
  }
  return { root, store, library, translations, add, translate };
}

test("译本覆盖只统计英文原文，缺译与待复核分开计数", async t => {
  const { library, translations, add, translate } = await fixture(t);

  const done = await add(ENGLISH);
  await translate(done);
  const missing = await add(ENGLISH);
  await add(CHINESE);
  const stale = await add(ENGLISH);
  await translate(stale);
  fs.appendFileSync(path.join(stale.central_path, "SKILL.md"), "\n## New section\n\nAdded later.\n");

  const coverage = translations.coverage();
  assert.equal(coverage.total, 4);
  assert.equal(coverage.english, 3, "中文原文的技能不计入分母");
  assert.equal(coverage.chinese, 1);
  assert.equal(coverage.translated, 1);
  assert.equal(coverage.stale, 1);
  assert.equal(coverage.missing, 1);
  assert.deepEqual(coverage.missing_skills.map(item => item.id), [missing.id]);
  assert.deepEqual(coverage.missing_skills.map(item => item.name), [missing.name]);
  assert.deepEqual(coverage.stale_skills.map(item => item.id), [stale.id]);
  assert.equal(coverage.translated + coverage.missing + coverage.stale, coverage.english);

  // 统计是只读的：原文、技能目录、已有译文都不变。
  assert.equal(translations.get(done.id).stale, false);
  assert.deepEqual(fs.readdirSync(done.central_path), ["SKILL.md"]);
  assert.equal(library.skillDocument(done.id).content.includes("Read the file"), true);
});

test("译文文件损坏按缺译处理，不会让整次统计失败", async t => {
  const { translations, add } = await fixture(t);
  const skill = await add(ENGLISH);
  fs.mkdirSync(path.dirname(translations.filename(skill.id)), { recursive: true });
  fs.writeFileSync(translations.filename(skill.id), "{ 不是合法 JSON");
  const coverage = translations.coverage();
  assert.equal(coverage.english, 1);
  assert.equal(coverage.missing, 1);
  assert.deepEqual(coverage.missing_skills.map(item => item.id), [skill.id]);
});

test("语言判定：代码块按英文剔除，中文文档不会被误判成英文", () => {
  const chineseWithCode = [
    "---\nname: demo\ndescription: 中文说明\n---",
    "# 演示",
    "## 使用方法",
    "先按下面的命令跑一遍，再检查输出里的报错。",
    "```bash",
    "node scripts/verify.mjs --port 14400 --profile /tmp/profile",
    "```",
    "如果失败，就回到上一步核对参数。",
  ].join("\n");
  assert.equal(documentLanguage(chineseWithCode).language, "zh");

  const english = "---\nname: demo\n---\n# Demo\n\n## Usage\n\nRun the verifier before shipping.\n";
  assert.equal(documentLanguage(english).language, "en");
  assert.equal(documentLanguage("").language, "unknown");
  // frontmatter 里的中文描述不参与判定
  assert.equal(documentLanguage("---\nname: demo\ndescription: 中文描述\n---\n# Demo\n\nRun it.\n").language, "en");
});

test("统计命令是只读命令，可由前端直接调用", async t => {
  const { library, add, translate } = await fixture(t);
  const skill = await add(ENGLISH);
  await translate(skill);
  const commands = skillTranslationCommands(library);
  assert.equal(commands.get_translation_coverage.mutating, undefined);
  const coverage = commands.get_translation_coverage.call({});
  assert.equal(coverage.english, 1);
  assert.equal(coverage.translated, 1);
  assert.equal(coverage.missing, 0);
});
