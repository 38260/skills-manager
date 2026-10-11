import assert from "node:assert/strict";
import { test } from "node:test";
import { pruneStaleTagFilters, UNTAGGED_FILTER } from "../../src/lib/skillTags.ts";

test("an empty saved category stays selected while removed categories are pruned", () => {
  const result = pruneStaleTagFilters(new Set(["UI", "removed", UNTAGGED_FILTER]), ["UI", "自定义"], true);
  assert.deepEqual([...result], ["UI", UNTAGGED_FILTER]);
});

test("renamed legacy membership keeps its new category selected before the catalogue refresh", () => {
  const selection = new Set(["Interface"]);
  assert.equal(pruneStaleTagFilters(selection, ["UI", "Interface"], true), selection);
});
