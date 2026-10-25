import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../../backend/store.mjs";

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manager-favorites-"));
  const home = path.join(root, "home");
  const directory = path.join(root, "data");
  fs.mkdirSync(home, { recursive: true });
  let store = new Store({ directory, home });
  t.after(() => {
    try { store.close(); } catch {}
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  });
  return { root, store };
}

test("setSkillFavorite toggles the favorited_at timestamp and validates skill existence", (t) => {
  const { root, store } = setup(t);
  const id = crypto.randomUUID();
  store.run(
    "INSERT INTO skills(id,name,source_type,central_path,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    id, "alpha", "import", path.join(root, "alpha"), Date.now(), Date.now(),
  );

  assert.equal(store.skill(id).favorited_at ?? null, null);

  const favorited = store.setSkillFavorite(id, true);
  assert.equal(typeof favorited.favorited_at, "number");

  const unfavorited = store.setSkillFavorite(id, false);
  assert.equal(unfavorited.favorited_at, null);

  // 重复收藏产生新的时间戳，供「最近收藏」类排序使用。
  const first = store.setSkillFavorite(id, true).favorited_at;
  const second = store.setSkillFavorite(id, true).favorited_at;
  assert.ok(second >= first);

  assert.throws(() => store.setSkillFavorite("no-such-id", true), /技能不存在/);
});
