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

// 快照是技能目录的完整复制：需要能看到总占用、按技能分组，并在清理前预览、
// 清理时保证每个技能最近 N 个恢复点不被删（即使前端传了它们的 ID）。
test("快照占用统计与清理：预览可回收量，执行后保留最近恢复点", async t => {
  const { snapshots, source, store, skill, root } = await fixture(t);
  const captured = [];
  for (const version of ["二", "三", "四"]) {
    fs.writeFileSync(path.join(source, "SKILL.md"), `---\nname: example\ndescription: version ${version}\n---\n版本${version}\n`);
    await snapshots.capture(skill.id, "before_update");
    captured.push(snapshots.list()[0].snapshot_id);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(snapshots.list().length, 3);

  const usage = snapshots.usage();
  assert.equal(usage.total_count, 3);
  assert.equal(usage.skill_count, 1);
  assert.equal(usage.by_skill[0].skill_id, skill.id);
  assert.equal(usage.by_skill[0].count, 3);
  assert.ok(usage.total_bytes > 0, "总占用应大于 0");
  assert.equal(usage.by_skill[0].size_bytes, usage.total_bytes);

  // 按技能筛选预览：只影响该技能。
  const preview = snapshots.planCleanup({ keepLatest: 2, skillId: skill.id });
  assert.equal(preview.keep_latest, 2);
  assert.equal(preview.removable.length, 1, "3 个快照、每个技能保留 2 个时应只有 1 个可删");
  assert.equal(preview.removable[0].snapshot_id, captured[0], "最旧的快照应被列为可删");
  assert.ok(preview.reclaim_bytes > 0);

  // 即使显式要求删最近的两个，也必须拒绝。
  const guarded = snapshots.cleanup({ snapshotIds: [captured[2], captured[1]], keepLatest: 2 });
  assert.equal(guarded.deleted, 0);
  assert.equal(guarded.failed.length, 2);
  assert.equal(snapshots.list().length, 3, "最近恢复点不能被删除");

  // 正常清理：只删预览里的那一份。
  const cleaned = snapshots.cleanup({ snapshotIds: [captured[0]], keepLatest: 2 });
  assert.equal(cleaned.deleted, 1);
  assert.equal(cleaned.failed.length, 0);
  assert.ok(cleaned.reclaim_bytes > 0);
  assert.equal(snapshots.list().length, 2);
  assert.ok(!fs.existsSync(path.join(root, "app", "skill-snapshots", captured[0])), "被清理的快照目录应删除");
  // 技能本体与最近恢复点不受影响。
  assert.ok(fs.existsSync(skill.central_path));
  assert.equal(store.skill(skill.id).id, skill.id);
});
