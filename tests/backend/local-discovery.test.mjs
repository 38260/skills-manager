import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";
import { scanCommands } from "../../backend/scan.mjs";

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manager-discovery-"));
  const home = path.join(root, "home");
  const directory = path.join(root, "data");
  fs.mkdirSync(home, { recursive: true });
  let store = new Store({ directory, home });
  t.after(() => {
    try { store.close(); } catch {}
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  });
  const commands = () => scanCommands(store, new Library(store));
  return {
    root, home, directory,
    get store() { return store; },
    commands,
    reopen() {
      store.close();
      store = new Store({ directory, home });
    },
  };
}

function writeSkill(directory, name, body = "正文") {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} 说明\n---\n${body}\n`);
}

function groupByName(result, name) {
  return result.groups.find(group => group.name === name);
}

test("custom parent and self directories are discovered once, overlapping sources and junctions do not duplicate", async t => {
  const fixture = setup(t);
  const { store, home, root, commands } = fixture;
  const toolRoot = path.join(home, ".codex", "skills");
  writeSkill(path.join(toolRoot, "tool-skill"), "tool-skill");

  const parent = path.join(root, "my-skills");
  writeSkill(path.join(parent, "alpha"), "alpha");
  writeSkill(path.join(parent, "beta"), "beta");
  fs.mkdirSync(path.join(parent, "plain-folder", "nested"), { recursive: true });
  fs.mkdirSync(path.join(parent, "missing-doc"), { recursive: true });

  const selfSkill = path.join(root, "single-skill");
  writeSkill(selfSkill, "single");

  const scan = commands();
  scan.add_local_discovery_dir.call({ path: parent });
  scan.add_local_discovery_dir.call({ path: selfSkill });
  scan.add_local_discovery_dir.call({ path: toolRoot });
  const duplicate = scan.add_local_discovery_dir.call({ path: parent + path.sep });
  assert.equal(duplicate.added, false, "同一路径重复添加不应产生新配置");

  let junction = null;
  try {
    junction = path.join(root, "junction-to-parent");
    fs.symlinkSync(parent, junction, "junction");
    const junctionAdd = scan.add_local_discovery_dir.call({ path: junction });
    assert.equal(junctionAdd.added, false, "Junction 指向同一目录时不应重复配置");
  } catch (error) {
    console.warn(`当前环境无法创建 Junction，跳过该断言：${error.message}`);
  }
  if (process.platform === "win32") {
    const caseVariant = scan.add_local_discovery_dir.call({ path: parent.toUpperCase() });
    assert.equal(caseVariant.added, false, "Windows 大小写不同的同一路径不应重复配置");
  }

  const result = await scan.scan_local_skills.call();
  assert.equal(result.status, "ok", JSON.stringify(result.errors));
  assert.deepEqual(result.groups.map(group => group.name).sort(), ["alpha", "beta", "single", "tool-skill"]);
  assert.equal(groupByName(result, "tool-skill").locations.length, 1, "工具目录与发现目录重叠时只计一次");
  assert.equal(groupByName(result, "single").locations.length, 1);
  assert.ok(!groupByName(result, "plain-folder") && !groupByName(result, "nested"), "没有 SKILL.md 的普通目录不应算技能");
  assert.ok(!groupByName(result, "missing-doc"));
  assert.ok(result.groups.every(group => group.locations.every(location => location.key.startsWith("path:"))), "每个位置都应有稳定路径标识");
  assert.equal(store.all("SELECT * FROM discovered_skills").length, 4);
  if (junction) fs.rmSync(junction, { recursive: true, force: true });
});

test("duplicate content groups share a stable key; content edits keep location keys stable", async t => {
  const fixture = setup(t);
  const { root, commands } = fixture;
  const content = "---\nname: twin\ndescription: 同内容\n---\n同一份正文\n";
  const one = path.join(root, "discovery", "twin-a");
  const two = path.join(root, "discovery", "twin-b");
  for (const directory of [one, two]) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "SKILL.md"), content);
  }
  const scan = commands();
  scan.add_local_discovery_dir.call({ path: path.join(root, "discovery") });
  const first = await scan.scan_local_skills.call();
  const twin = groupByName(first, "twin");
  assert.equal(twin.locations.length, 2);
  assert.equal(twin.key, twin.locations.map(location => location.key).sort()[0]);
  const keys = new Set(twin.locations.map(location => location.key));

  fs.appendFileSync(path.join(one, "SKILL.md"), "\n更新内容\n");
  const second = await scan.scan_local_skills.call();
  assert.equal(second.status, "ok");
  const nextKeys = new Set(second.groups.flatMap(group => group.locations.map(location => location.key)));
  for (const key of keys) assert.ok(nextKeys.has(key), `位置键应稳定：${key}`);
  assert.equal(second.groups.length, 2, "内容不同后应拆成两个分组");
});

test("one unreadable source keeps its last results while readable sources refresh", async t => {
  const fixture = setup(t);
  const { root, commands } = fixture;
  const good = path.join(root, "good");
  const flaky = path.join(root, "flaky");
  writeSkill(path.join(good, "alpha"), "alpha");
  writeSkill(path.join(flaky, "beta"), "beta");
  const scan = commands();
  scan.add_local_discovery_dir.call({ path: good });
  scan.add_local_discovery_dir.call({ path: flaky });
  const first = await scan.scan_local_skills.call();
  assert.equal(first.status, "ok");
  assert.equal(first.groups.length, 2);

  writeSkill(path.join(good, "gamma"), "gamma");
  fs.rmSync(flaky, { recursive: true, force: true });
  const second = await scan.scan_local_skills.call();
  assert.equal(second.status, "partial");
  assert.ok(second.groups.some(group => group.name === "gamma"), "可读来源的新技能应被发现");
  assert.ok(second.groups.some(group => group.name === "beta"), "失败来源应保留上一轮结果");
  const failedSource = second.sources.find(source => source.path === flaky);
  assert.equal(failedSource.status, "error");
  assert.ok(failedSource.error, "失败来源应带可读错误");
  assert.ok(second.errors.some(error => error.source_key === failedSource.key));
});

test("total source failure keeps the last successful result instead of pretending no skills", async t => {
  const fixture = setup(t);
  const { root, commands } = fixture;
  const only = path.join(root, "only");
  writeSkill(path.join(only, "solo"), "solo");
  const scan = commands();
  scan.add_local_discovery_dir.call({ path: only });
  const first = await scan.scan_local_skills.call();
  assert.equal(first.status, "ok");
  fs.rmSync(only, { recursive: true, force: true });
  const failed = await scan.scan_local_skills.call();
  assert.equal(failed.status, "failed");
  assert.equal(failed.groups.length, 1, "失败结果仍返回最后一次成功分组");
  assert.equal(failed.groups[0].name, "solo");
  assert.ok(failed.errors.length > 0);
});

test("concurrent scan calls reuse the same in-flight task", async t => {
  const fixture = setup(t);
  const { root, commands } = fixture;
  writeSkill(path.join(root, "skills", "alpha"), "alpha");
  const scan = commands();
  scan.add_local_discovery_dir.call({ path: path.join(root, "skills") });
  const first = scan.scan_local_skills.call();
  const second = scan.scan_local_skills.call();
  assert.equal(first, second, "并发调用必须复用同一个任务");
  const result = await first;
  assert.equal(result.status, "ok");
  assert.equal(result.groups[0].name, "alpha");
});

test("discovery directories persist across restart, remove only affects scan scope, and invalid paths are rejected", t => {
  const fixture = setup(t);
  const { root } = fixture;
  const directory = path.join(root, "persisted");
  writeSkill(path.join(directory, "kept"), "kept");
  let scan = fixture.commands();
  const added = scan.add_local_discovery_dir.call({ path: directory });
  assert.equal(added.added, true);
  assert.equal(added.dirs[0].exists, true);
  assert.equal(added.dirs[0].readable, true);

  fixture.reopen();
  scan = fixture.commands();
  const listed = scan.get_local_discovery_dirs.call();
  assert.equal(listed.length, 1, "重启后配置仍应存在");
  assert.equal(listed[0].path, path.resolve(directory));

  assert.throws(() => scan.add_local_discovery_dir.call({ path: path.join(root, "does-not-exist") }), /不存在|不可访问/);
  assert.throws(() => scan.add_local_discovery_dir.call({ path: "relative/path" }), /绝对路径/);
  assert.throws(() => scan.add_local_discovery_dir.call({ path: path.parse(root).root }), /根目录/);

  const removed = scan.remove_local_discovery_dir.call({ path: directory });
  assert.equal(removed.removed, true);
  assert.equal(removed.dirs.length, 0);
  assert.equal(fs.existsSync(path.join(directory, "kept", "SKILL.md")), true, "移除配置不得删除源文件");
});

test("import marks the pending group and leaves the source skill untouched", async t => {
  const fixture = setup(t);
  const { root, commands } = fixture;
  const source = path.join(root, "sources", "import-me");
  writeSkill(source, "import-me", "原始正文");
  const scan = commands();
  scan.add_local_discovery_dir.call({ path: path.join(root, "sources") });
  const first = await scan.scan_local_skills.call();
  const group = groupByName(first, "import-me");
  assert.equal(group.imported, false);

  scan.import_existing_skill.call({ sourcePath: group.locations[0].found_path, name: null });
  const second = await scan.scan_local_skills.call();
  assert.equal(groupByName(second, "import-me").imported, true);
  assert.equal(fs.readFileSync(path.join(source, "SKILL.md"), "utf8").includes("原始正文"), true);
  assert.deepEqual(fs.readdirSync(source).sort(), ["SKILL.md"], "扫描与导入不应改写源技能内容");
});
