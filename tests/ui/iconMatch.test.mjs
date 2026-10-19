import assert from "node:assert/strict";
import { test } from "node:test";
import { SKILL_AUTO_ICON_KEY, autoMatchSkillIconKey, inferSkillIconKey, tagsMatchingIcon } from "../../src/lib/iconMatch.ts";

test("an explicitly chosen logo wins over the tag match", () => {
  assert.equal(inferSkillIconKey({ icon: "rocket", tags: ["设计"] }), "rocket");
});

test("a curated tag matches the logo before the skill's own wording does", () => {
  assert.equal(inferSkillIconKey({ tags: ["设计"] }), "palette");
  assert.equal(autoMatchSkillIconKey({ tags: ["数据"], name: "pdf-converter", description: "文档处理" }), "database");
});

test("without tags the logo is matched from the skill name and description", () => {
  assert.equal(autoMatchSkillIconKey({ name: "archify", description: "PDF 文档转换" }), "book-open");
  assert.equal(autoMatchSkillIconKey({ display_name: "竞品研究", description: "市场调研" }), "search");
});

test("nothing classifiable keeps the neutral marker instead of guessing", () => {
  assert.equal(autoMatchSkillIconKey({ name: "Untitled", description: "—" }), SKILL_AUTO_ICON_KEY);
  assert.equal(autoMatchSkillIconKey(null), SKILL_AUTO_ICON_KEY);
});

test("a logo suggests only the library tags of the same topic", () => {
  const allTags = ["设计", "数据", "UI", "测试", "未分类"];
  assert.deepEqual(tagsMatchingIcon("palette", allTags), ["设计", "UI"]);
  assert.deepEqual(tagsMatchingIcon("database", allTags), ["数据"]);
  assert.deepEqual(tagsMatchingIcon("flask-conical", allTags), ["测试"]);
  assert.deepEqual(tagsMatchingIcon("layers", allTags), []);
});
