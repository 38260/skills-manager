import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";
import { hashDirectory } from "../../backend/files.mjs";
import { SkillTranslations, skillTranslationCommands } from "../../backend/skill-translations.mjs";

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manager-translation-test-"));
  const store = new Store({ directory: path.join(root, "app"), home: root });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true }); });
  const source = path.join(root, "source");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "SKILL.md"), "---\nname: english-example\n---\n# English example\n\n## Usage\nRead this.\n");
  const library = new Library(store);
  const skill = await library.installLocal(source);
  return { root, store, library, skill, translations: new SkillTranslations(library) };
}

test("译文独立持久保存，不修改原文、部署指纹与已有展示信息", async t => {
  const { store, library, skill, translations } = await fixture(t);
  store.setProfile(skill.id, { alias: "已有别名", customDescription: "已有说明" });
  const before = library.skillDocument(skill.id).content, hash = hashDirectory(skill.central_path);
  const empty = translations.get(skill.id);
  assert.equal(empty.content, null);
  const content = "# 中文示例\n\n## 使用方法\n读这里。\n```js\nconst ok = true;\n```\n";
  const saved = translations.save({ skillId: skill.id, content, sourceHash: empty.source_hash, expectedRevision: null });
  assert.equal(saved.content, content);
  assert.equal(saved.stale, false);
  assert.deepEqual(new SkillTranslations(library).get(skill.id), saved);
  assert.equal(library.skillDocument(skill.id).content, before);
  assert.equal(hashDirectory(skill.central_path), hash);
  assert.deepEqual(fs.readdirSync(skill.central_path), ["SKILL.md"]);
  assert.equal(store.skill(skill.id).alias, "已有别名");
  assert.equal(store.skill(skill.id).custom_description, "已有说明");
  assert.match(translations.filename(skill.id).replaceAll("\\", "/"), /\/skills\/\.skills-manager\/translations\//);
});

test("原文变化保留旧译文并标为过期，拒绝以旧版本覆盖", async t => {
  const { library, skill, translations } = await fixture(t);
  const old = translations.get(skill.id);
  const saved = translations.save({ skillId: skill.id, content: "旧译文", sourceHash: old.source_hash, expectedRevision: null });
  fs.appendFileSync(path.join(skill.central_path, "SKILL.md"), "\n## New section\nNew content\n");
  const current = translations.get(skill.id);
  assert.equal(current.stale, true);
  assert.equal(current.content, "旧译文");
  assert.notEqual(current.source_hash, saved.source_hash);
  assert.throws(() => translations.save({ skillId: skill.id, content: "未核对", sourceHash: old.source_hash, expectedRevision: saved.revision }), /原文已变化/);
  assert.equal(library.skillDocument(skill.id).content.includes("New section"), true);
  const updated = translations.save({ skillId: skill.id, content: "核对后的译文", sourceHash: current.source_hash, expectedRevision: current.revision });
  assert.equal(updated.stale, false);
});

test("并发保存不能覆盖另一窗口的译文", async t => {
  const { skill, translations } = await fixture(t);
  const original = translations.get(skill.id);
  translations.save({ skillId: skill.id, content: "窗口一", sourceHash: original.source_hash, expectedRevision: null });
  assert.throws(() => translations.save({ skillId: skill.id, content: "窗口二", sourceHash: original.source_hash, expectedRevision: null }), /其他窗口修改/);
  assert.equal(translations.get(skill.id).content, "窗口一");
});

test("错误参数、未知技能、越界路径不会写入译文", async t => {
  const { root, skill, translations } = await fixture(t);
  const current = translations.get(skill.id);
  for (const content of [null, 12, {}, "  ", "中".repeat(1_500_000)]) {
    assert.throws(() => translations.save({ skillId: skill.id, content, sourceHash: current.source_hash, expectedRevision: null }));
  }
  for (const id of [null, "", "missing", "../../escape"]) assert.throws(() => translations.get(id));
  assert.throws(() => translations.filename("../../escape"), /路径超出/);
  assert.equal(fs.existsSync(path.join(root, "escape.zh-CN.json")), false);
  assert.equal(translations.get(skill.id).content, null);
});

test("损坏译文必须报错并保留文件，不能当成缺失并覆盖", async t => {
  const { skill, translations } = await fixture(t);
  const current = translations.get(skill.id), filename = translations.filename(skill.id);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  for (const raw of ["broken json", '{"version":1,"content":5}', "null"]) {
    fs.writeFileSync(filename, raw);
    assert.throws(() => translations.get(skill.id));
    assert.throws(() => translations.save({ skillId: skill.id, content: "不能覆盖", sourceHash: current.source_hash, expectedRevision: null }));
    assert.equal(fs.readFileSync(filename, "utf8"), raw);
  }
});

test("命令注册标注写操作，读取只返回对应技能译文", async t => {
  const { library, skill } = await fixture(t);
  const commands = skillTranslationCommands(library);
  assert.equal(commands.set_skill_translation.mutating, true);
  assert.equal(commands.get_skill_translation.mutating, undefined);
  const initial = commands.get_skill_translation.call({ skillId: skill.id });
  const saved = commands.set_skill_translation.call({ skillId: skill.id, content: "# 中文", sourceHash: initial.source_hash, expectedRevision: null });
  assert.deepEqual(commands.get_skill_translation.call({ skillId: skill.id }), saved);
  assert.throws(() => commands.get_skill_translation.call({ skillId: "different-skill" }));
});
