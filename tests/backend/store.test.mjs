import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../../backend/store.mjs";
import { metadata, inside } from "../../backend/files.mjs";

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manager-store-test-"));
  const store = new Store({ directory, home: directory });
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true }); });
  return store;
}

test("categories keep empty groups and preserve skills across rename/delete/restart", t => {
  const store = fixture(t);
  store.createCategory("Docs"); store.createCategory("Docs");
  store.renameCategory("UI", "Interface"); store.deleteCategory("自定义");
  assert.deepEqual(store.categories(), ["Docs", "Interface"]);
  assert.throws(() => store.createCategory(" "));
  store.run("INSERT INTO skills(id,name,source_type,central_path) VALUES(?,?,?,?)", "one", "one", "local", path.join(store.skillsDirectory,"one"));
  store.setTags("one", ["Docs", "Interface"]); store.deleteCategory("Docs");
  assert.equal(store.skill("one").id, "one"); assert.deepEqual(store.tags("one"), ["Interface"]);
  const reopened = new Store({ directory: store.directory, home: store.home });
  assert.deepEqual(reopened.categories(), ["Interface"]); reopened.close();
});

test("author is derived from existing and edited files, with standard priority and invalid-value handling", t => {
  const store=fixture(t), directory=path.join(store.skillsDirectory,"example"); fs.mkdirSync(directory);
  const filename=path.join(directory,"SKILL.md");
  fs.writeFileSync(filename,"\uFEFF---\r\nname: example\r\nauthor: Legacy\r\nmetadata:\r\n  author: Alice\r\n---\r\n# Example");
  store.run("INSERT INTO skills(id,name,source_type,central_path) VALUES(?,?,?,?)","example","example","import",directory);
  assert.equal(store.skill("example").author,"Alice"); assert.equal(store.skill("example").author_source,"metadata.author");
  fs.writeFileSync(filename,"---\nname: example\nauthor: Bob\n---\n"); assert.equal(store.skill("example").author,"Bob");
  fs.writeFileSync(filename,"---\nname: example\nmetadata:\n  author: [Alice]\n---\n"); assert.equal(metadata(directory).author,null);
  assert.throws(() => inside(directory,"../escape"));
});

test("sensitive preferences use the existing authenticated encryption format", t => {
  const store=fixture(t); store.setSetting("proxy_url","https://user:example@localhost:9000");
  const encrypted=store.get("SELECT value FROM settings WHERE key='proxy_url'").value;
  assert.ok(encrypted.startsWith("enc:v1:")); assert.ok(!encrypted.includes("example"));
  assert.equal(store.getSetting("proxy_url"),"https://user:example@localhost:9000");
  const last=(parseInt(encrypted.slice(-2),16)^1).toString(16).padStart(2,"0");
  store.run("UPDATE settings SET value=? WHERE key='proxy_url'",encrypted.slice(0,-2)+last);
  assert.throws(() => store.getSetting("proxy_url"));
});
