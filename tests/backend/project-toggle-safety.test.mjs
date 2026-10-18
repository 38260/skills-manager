import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";
import { projectCommands } from "../../backend/projects.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manager-toggle-safety-"));
  const store = new Store({ directory: path.join(root, "app"), home: path.join(root, "home") });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const enabledRoot = path.join(root, "enabled"), disabledRoot = path.join(root, "disabled");
  fs.mkdirSync(enabledRoot); fs.mkdirSync(disabledRoot);
  const commands = projectCommands(store, new Library(store));
  const project = commands.add_linked_workspace.call({ name: "Toggle safety", path: enabledRoot, disabledPath: disabledRoot });
  const agent = store.project(project.id).linked_agent_key;
  return {
    root, enabledPath: path.join(enabledRoot, "alpha"), disabledPath: path.join(disabledRoot, "alpha"),
    toggle: enabled => commands.toggle_project_skill.call({ projectId: project.id, skillRelativePath: "alpha", agent, enabled }),
  };
}

function writeSkill(directory, content) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "SKILL.md"), `---\nname: alpha\n---\n${content}\n`);
}

for (const sameContent of [false, true]) {
  test(`启停冲突保留两份普通目录（内容${sameContent ? "相同" : "不同"}）`, t => {
    const f = fixture(t);
    writeSkill(f.enabledPath, "enabled content");
    writeSkill(f.disabledPath, sameContent ? "enabled content" : "unique disabled content");
    const before = [f.enabledPath, f.disabledPath].map(directory => fs.readFileSync(path.join(directory, "SKILL.md")));
    for (const enabled of [false, true]) {
      assert.throws(() => f.toggle(enabled), error => error.code === "CONFLICT" && /已保留两份/.test(error.message));
      for (const [index, directory] of [f.enabledPath, f.disabledPath].entries()) {
        assert.deepEqual(fs.readFileSync(path.join(directory, "SKILL.md")), before[index]);
      }
    }
  });
}

for (const sameTarget of [false, true]) {
  test(`启停冲突保留两侧链接及其${sameTarget ? "共同" : "不同"}目标`, t => {
    const f = fixture(t);
    const first = path.join(f.root, "first"), second = sameTarget ? first : path.join(f.root, "second");
    writeSkill(first, "first target");
    if (!sameTarget) writeSkill(second, "second target");
    const linkType = process.platform === "win32" ? "junction" : "dir";
    fs.symlinkSync(first, f.enabledPath, linkType); fs.symlinkSync(second, f.disabledPath, linkType);
    for (const enabled of [false, true]) {
      assert.throws(() => f.toggle(enabled), /同名技能冲突/);
      assert.ok(fs.lstatSync(f.enabledPath).isSymbolicLink());
      assert.ok(fs.lstatSync(f.disabledPath).isSymbolicLink());
      assert.match(fs.readFileSync(path.join(first, "SKILL.md"), "utf8"), /first target/);
      assert.match(fs.readFileSync(path.join(second, "SKILL.md"), "utf8"), sameTarget ? /first target/ : /second target/);
    }
  });
}

test("失效链接仍视为同名占用，正常副本不被删除", t => {
  const f = fixture(t);
  writeSkill(f.disabledPath, "unique disabled content");
  fs.symlinkSync(path.join(f.root, "missing"), f.enabledPath, process.platform === "win32" ? "junction" : "dir");
  assert.equal(fs.existsSync(f.enabledPath), false);
  for (const enabled of [false, true]) {
    assert.throws(() => f.toggle(enabled), /同名技能冲突/);
    assert.ok(fs.lstatSync(f.enabledPath).isSymbolicLink());
    assert.match(fs.readFileSync(path.join(f.disabledPath, "SKILL.md"), "utf8"), /unique disabled content/);
  }
});

for (const linked of [false, true]) {
  test(`正常启停${linked ? "链接" : "目录"}保持内容，重复请求保持幂等`, t => {
    const f = fixture(t), original = path.join(f.root, "original");
    if (linked) {
      writeSkill(original, "original content");
      fs.symlinkSync(original, f.enabledPath, process.platform === "win32" ? "junction" : "dir");
    } else writeSkill(f.enabledPath, "original content");
    for (const enabled of [false, false, true, true]) {
      f.toggle(enabled);
      const present = enabled ? f.enabledPath : f.disabledPath, absent = enabled ? f.disabledPath : f.enabledPath;
      assert.match(fs.readFileSync(path.join(present, "SKILL.md"), "utf8"), /original content/);
      assert.equal(fs.existsSync(absent), false);
      assert.equal(fs.lstatSync(present).isSymbolicLink(), linked);
      if (linked) assert.match(fs.readFileSync(path.join(original, "SKILL.md"), "utf8"), /original content/);
    }
  });
}
