import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";
import { SkillSnapshots } from "../../backend/skill-snapshots.mjs";

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manager-snapshot-test-"));
  const store = new Store({ directory: path.join(root, "app"), home: root });
  const library = new Library(store);
  const snapshots = new SkillSnapshots(library);
  const source = path.join(root, "source");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "SKILL.md"), "---\nname: example\ndescription: version one\n---\nVersion one\n");
  const skill = await library.installLocal(source);
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true }); });
  return { root, store, library, snapshots, source, skill };
}

test("主更新与删除流程自动捕获快照；manifest 写入失败同时回滚文件、数据库和元数据", async t => {
  const { store, library, snapshots, source, skill } = await fixture(t);
  library.snapshots = snapshots;
  const before = store.get("SELECT * FROM skills WHERE id=?", skill.id);
  const manifest = path.join(store.directory, "install-manifests", `${skill.id}.json`);
  const beforeManifest = fs.readFileSync(manifest, "utf8");
  fs.writeFileSync(path.join(source, "SKILL.md"), "---\nname: example\ndescription: version two\n---\nVersion two\n");
  t.mock.method(library, "saveManifest", () => { throw new Error("模拟 manifest 写盘失败"); });
  await assert.rejects(library.update(skill.id), /模拟 manifest 写盘失败/);
  t.mock.restoreAll();
  assert.deepEqual(store.get("SELECT * FROM skills WHERE id=?", skill.id), before);
  assert.match(fs.readFileSync(path.join(skill.central_path, "SKILL.md"), "utf8"), /Version one/);
  assert.equal(fs.readFileSync(manifest, "utf8"), beforeManifest);
  await library.update(skill.id);
  assert.ok(snapshots.list().some(item => item.reason === "before_update"));
  library.remove(skill.id);
  const deleted = snapshots.list().find(item => item.reason === "before_delete");
  assert.ok(deleted.deleted);
  await snapshots.restore(deleted.snapshot_id);
  assert.equal(store.skill(skill.id).id, skill.id);
  assert.match(fs.readFileSync(path.join(skill.central_path, "SKILL.md"), "utf8"), /Version two/);
});

test("恢复等待 Agent 部署时拒绝同技能更新、重导入、重新关联、分离与删除", async t => {
  const { store, library, snapshots, source, skill } = await fixture(t);
  library.snapshots = snapshots;store.setSetting("sync_mode", "copy");
  await library.deploy(skill.id, "codex");
  const snapshot = snapshots.capture(skill.id, "before_update");
  let release;const wait = new Promise(resolve => { release = resolve; });
  t.mock.method(library, "deploy", async () => { await wait; });
  const restoring = snapshots.restore(snapshot.snapshot_id);
  await assert.rejects(library.update(skill.id), /正在恢复/);
  await assert.rejects(library.reimport(skill.id), /正在恢复/);
  await assert.rejects(library.relink(skill.id, source), /正在恢复/);
  assert.throws(() => library.remove(skill.id), /正在更新或恢复/);
  assert.throws(() => library.detach(skill.id), /正在更新或恢复/);
  assert.ok(fs.existsSync(skill.central_path));release();await restoring;
  assert.equal(snapshots.restoring.size, 0);
});

test("deleted skill restores its original identity, profile, tags and remaining preset members", async t => {
  const { store, library, snapshots, skill } = await fixture(t);
  store.setTags(skill.id, ["UI"]);
  store.setProfile(skill.id, { alias: "My skill", customDescription: "Custom note" });
  const preset = store.presets()[0];
  store.addSkillToPreset(skill.id, preset.id);
  store.run("INSERT INTO scenario_skill_tools(scenario_id,skill_id,tool,enabled,updated_at) VALUES(?,?,?,?,?)", preset.id, skill.id, "codex", false, Date.now());
  fs.mkdirSync(path.join(skill.central_path, "empty"));
  const manifest = fs.readFileSync(path.join(store.directory, "install-manifests", `${skill.id}.json`), "utf8");
  const snapshot = snapshots.capture(skill.id, "before_delete");
  library.remove(skill.id);
  assert.equal(snapshots.list()[0].deleted, true);
  const restored = await snapshots.restore(snapshot.snapshot_id);
  assert.equal(restored.skill.id, skill.id);
  assert.equal(restored.skill.display_name, "My skill");
  assert.deepEqual(restored.skill.tags, ["UI"]);
  assert.deepEqual(restored.skill.preset_ids, [preset.id]);
  assert.equal(store.get("SELECT enabled FROM scenario_skill_tools WHERE skill_id=?", skill.id).enabled, 0);
  assert.match(fs.readFileSync(path.join(skill.central_path, "SKILL.md"), "utf8"), /Version one/);
  assert.ok(fs.statSync(path.join(skill.central_path, "empty")).isDirectory());
  assert.equal(fs.readFileSync(path.join(store.directory, "install-manifests", `${skill.id}.json`), "utf8"), manifest);
  assert.equal(snapshots.list().length, 1);
  assert.equal(snapshots.list()[0].deleted, false);
});

test("restoring an earlier version saves the current version and protects edited Agent copies", async t => {
  const { root, store, library, snapshots, skill } = await fixture(t);
  store.setSetting("sync_mode", "copy");
  await library.deploy(skill.id, "codex");
  const snapshot = snapshots.capture(skill.id, "before_update");
  fs.writeFileSync(path.join(skill.central_path, "SKILL.md"), "---\nname: example\n---\nVersion two\n");
  const target = path.join(root, ".codex", "skills", "example");
  fs.writeFileSync(path.join(target, "notes.txt"), "User edit after update");
  const restored = await snapshots.restore(snapshot.snapshot_id);
  assert.equal(restored.deployments[0].status, "failed");
  assert.match(restored.deployments[0].message, /本地修改/);
  assert.equal(fs.readFileSync(path.join(target, "notes.txt"), "utf8"), "User edit after update");
  assert.match(fs.readFileSync(path.join(skill.central_path, "SKILL.md"), "utf8"), /Version one/);
  assert.ok(restored.safety_snapshot_id);
  const safety = snapshots.read(restored.safety_snapshot_id);
  assert.match(fs.readFileSync(path.join(safety.directory, "content", "SKILL.md"), "utf8"), /Version two/);
  assert.equal(snapshots.list().length, 2);
});

test("deletion undo restores clean copies but keeps modified copies as unclaimed user content", async t => {
  const { root, store, library, snapshots, skill } = await fixture(t);
  store.setSetting("sync_mode", "copy");
  await library.deploy(skill.id, "codex");
  await library.deploy(skill.id, "claude_code");
  const codexTarget = path.join(root, ".codex", "skills", "example");
  fs.writeFileSync(path.join(codexTarget, "notes.txt"), "User edit");
  const snapshot = snapshots.capture(skill.id, "before_delete");
  library.remove(skill.id);
  assert.ok(fs.existsSync(codexTarget));
  const restored = await snapshots.restore(snapshot.snapshot_id);
  assert.equal(restored.deployments.find(item => item.tool === "codex").status, "failed");
  assert.equal(restored.deployments.find(item => item.tool === "claude_code").status, "success");
  assert.equal(fs.readFileSync(path.join(codexTarget, "notes.txt"), "utf8"), "User edit");
});

test("tampered snapshots, traversal IDs and occupied original paths never overwrite user files", async t => {
  const { library, snapshots, skill } = await fixture(t);
  const snapshot = snapshots.capture(skill.id, "before_delete");
  const content = path.join(snapshots.directory, snapshot.snapshot_id, "content", "SKILL.md");
  fs.writeFileSync(content, "Tampered contents");
  await assert.rejects(snapshots.restore(snapshot.snapshot_id), /校验失败/);
  assert.match(fs.readFileSync(path.join(skill.central_path, "SKILL.md"), "utf8"), /Version one/);
  assert.throws(() => snapshots.restore("../escape"), /快照 ID/);
  const second = snapshots.capture(skill.id, "before_delete");
  library.remove(skill.id);
  fs.mkdirSync(skill.central_path);
  fs.writeFileSync(path.join(skill.central_path, "keep.txt"), "User replacement");
  await assert.rejects(snapshots.restore(second.snapshot_id), /未纳管内容/);
  assert.equal(fs.readFileSync(path.join(skill.central_path, "keep.txt"), "utf8"), "User replacement");
});

test("metadata write failure rolls database and central files back to the pre-restore version", async t => {
  const { store, snapshots, skill } = await fixture(t);
  const snapshot = snapshots.capture(skill.id, "before_update");
  fs.writeFileSync(path.join(skill.central_path, "SKILL.md"), "---\nname: example\n---\nVersion two\n");
  store.setTags(skill.id, ["Current"]);
  const saveMetadata = store.saveMetadata;
  store.saveMetadata = () => { throw new Error("simulated disk failure"); };
  await assert.rejects(snapshots.restore(snapshot.snapshot_id), /disk failure/);
  store.saveMetadata = saveMetadata;
  assert.match(fs.readFileSync(path.join(skill.central_path, "SKILL.md"), "utf8"), /Version two/);
  assert.deepEqual(store.skill(skill.id).tags, ["Current"]);
  assert.equal(snapshots.list().length, 2);
});

test("snapshot scope excludes app credentials and permits placeholder examples", async t => {
  const { store, snapshots, skill } = await fixture(t);
  store.setSetting("credential:github", "app-secret-should-not-be-copied");
  store.run("UPDATE skills SET source_ref=? WHERE id=?", "https://user:password@example.com/repo.git?token=private", skill.id);
  fs.writeFileSync(path.join(skill.central_path, ".env.example"), "API_KEY=your_api_key_here\n");
  const snapshot = snapshots.capture(skill.id, "before_update");
  const serialized = fs.readFileSync(path.join(snapshots.directory, snapshot.snapshot_id, "snapshot.json"), "utf8");
  assert.equal(serialized.includes("app-secret-should-not-be-copied"), false);
  assert.equal(serialized.includes("password"), false);
  assert.equal(serialized.includes("private"), false);
  assert.equal(fs.existsSync(path.join(snapshots.directory, snapshot.snapshot_id, "content", ".env.example")), true);
  fs.writeFileSync(path.join(skill.central_path, ".env"), "API_KEY=secret\n");
  assert.throws(() => snapshots.capture(skill.id, "before_delete"), /凭据文件/);
  assert.ok(fs.existsSync(path.join(skill.central_path, ".env")));
});
