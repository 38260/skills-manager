import assert from "node:assert/strict";
import { test } from "node:test";
import { sortLibrarySkills } from "../../src/lib/librarySort.ts";

const skills = [
  { id: "a", name: "Alpha", preset_ids: ["preset"] },
  { id: "b", name: "Beta", preset_ids: [] },
  { id: "c", name: "Charlie", preset_ids: ["preset"] },
  { id: "d", name: "Delta", preset_ids: [] },
  { id: "e", name: "Echo", preset_ids: [] },
];
const usage = { a: { count: 2, lastUsedAt: 100 }, b: { count: 8, lastUsedAt: 50 }, c: { count: 2, lastUsedAt: 200 }, e: { count: 0, lastUsedAt: null } };
const ids = rows => rows.map(row => row.id);

test("usage sorting covers both directions, missing and zero counts without changing input", () => {
  assert.deepEqual(ids(sortLibrarySkills(skills, "usage-desc", usage, null, [])), ["b", "a", "c", "d", "e"]);
  assert.deepEqual(ids(sortLibrarySkills(skills, "usage-asc", usage, null, [])), ["d", "e", "a", "c", "b"]);
  assert.deepEqual(ids(skills), ["a", "b", "c", "d", "e"]);
});

test("usage takes priority over preset groups and ties retain the default preset order", () => {
  assert.deepEqual(ids(sortLibrarySkills(skills, "usage-desc", usage, "preset", ["c", "a"])), ["b", "c", "a", "d", "e"]);
  assert.deepEqual(ids(sortLibrarySkills(skills, "usage-asc", usage, "preset", ["c", "a"])), ["d", "e", "c", "a", "b"]);
});

test("default and empty usage preserve existing library and preset ordering", () => {
  assert.deepEqual(ids(sortLibrarySkills(skills, "default", usage, null, [])), ids(skills));
  assert.deepEqual(ids(sortLibrarySkills(skills, "default", usage, "preset", ["c", "a"])), ["c", "a", "b", "d", "e"]);
  assert.deepEqual(ids(sortLibrarySkills(skills, "usage-desc", {}, "preset", [])), ["a", "c", "b", "d", "e"]);
  assert.deepEqual(sortLibrarySkills([], "usage-asc", {}, null, []), []);
});

test("filtered results and refreshed counts use the same ordering rules", () => {
  assert.deepEqual(ids(sortLibrarySkills(skills.filter(skill => skill.preset_ids.length), "usage-desc", usage, null, [])), ["a", "c"]);
  assert.equal(sortLibrarySkills(skills, "usage-desc", { ...usage, d: { count: 9, lastUsedAt: 300 } }, null, [])[0].id, "d");
});
