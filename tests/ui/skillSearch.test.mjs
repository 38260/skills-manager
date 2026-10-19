import assert from "node:assert/strict";
import { test } from "node:test";
import { getSkillDisplayNames, matchSkillSearch } from "../../src/lib/skillSearch.ts";

const skill = {
  id: "one", name: "image-tool", alias: "海报助手", display_name: "海报助手",
  description: "Original raster image workflow", custom_description: "制作宣传海报",
  display_description: "制作宣传海报", central_path: "D:\\Library\\skills\\image-tool-custom",
};

test("library and command search find both original and customized information", () => {
  assert.deepEqual(matchSkillSearch(skill, " 海报助手 "), { field: "alias", value: "海报助手", index: 0 });
  assert.deepEqual(matchSkillSearch(skill, "IMAGE-TOOL"), { field: "name", value: "image-tool", index: 0 });
  assert.deepEqual(matchSkillSearch(skill, "宣传"), { field: "customDescription", value: "制作宣传海报", index: 2 });
  assert.deepEqual(matchSkillSearch(skill, "raster"), { field: "description", value: "Original raster image workflow", index: 9 });
  assert.deepEqual(matchSkillSearch(skill, "tool-custom"), { field: "directory", value: "image-tool-custom", index: 6 });
  assert.equal(matchSkillSearch(skill, "not present"), null);
  assert.deepEqual(matchSkillSearch(skill, "   "), { field: null, value: "", index: -1 });
});

test("duplicate skills use the same distinguishing directory labels in both views", () => {
  const rows = [
    { ...skill, id: "a", alias: null, display_name: "image-tool", central_path: "/library/image-tool-first" },
    { ...skill, id: "b", alias: null, display_name: "image-tool", central_path: "/library/image-tool-second" },
    { ...skill, id: "c" },
  ];
  const names = getSkillDisplayNames(rows);
  assert.equal(names.get("a"), "image-tool-first");
  assert.equal(names.get("b"), "image-tool-second");
  assert.equal(names.get("c"), "海报助手");
  assert.equal(matchSkillSearch(rows[1], "second", names.get("b")).field, "directory");
});

test("older rows without profile fields remain searchable and keep the original label", () => {
  const legacy = { id: "old", name: "Legacy", description: null, central_path: "D:/Skills/legacy" };
  assert.equal(getSkillDisplayNames([legacy]).get("old"), "Legacy");
  assert.equal(matchSkillSearch(legacy, "legacy").field, "name");
  assert.equal(matchSkillSearch(legacy, "missing"), null);
  assert.equal(matchSkillSearch({ ...legacy, display_description: "Custom note" }, "note").field, "customDescription");
});
