import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";
import { projectCommands } from "../../backend/projects.mjs";
import { workspaceCommands } from "../../backend/workspace.mjs";
import { skillOperationCommands } from "../../backend/skill-operations.mjs";

function writeSkill(directory, body) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "SKILL.md"), `---\nname: alpha\n---\n${body}\n`);
}

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manager-push-safety-"));
  const home = path.join(root, "home");
  for (const agent of [".claude", ".codex", ".cursor"]) fs.mkdirSync(path.join(home, agent), { recursive: true });
  const store = new Store({ directory: path.join(root, "app"), home });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const library = new Library(store); skillOperationCommands(library);
  const input = path.join(root, "input"); writeSkill(input, "baseline");
  fs.writeFileSync(path.join(input, "baseline.txt"), "baseline file");
  const skill = await library.installLocal(input);
  store.setSetting("sync_mode", "copy");
  await library.deploy(skill.id, "codex"); await library.deploy(skill.id, "cursor");
  const targets = Object.fromEntries(store.skill(skill.id).targets.map(target => [target.tool, target.target_path]));
  const projectRoot = path.join(root, "project");
  writeSkill(path.join(projectRoot, ".claude", "skills", "alpha"), "project revision");
  fs.writeFileSync(path.join(projectRoot, ".claude", "skills", "alpha", "baseline.txt"), "baseline file");
  const projects = projectCommands(store, library), workspace = workspaceCommands(store, library);
  const project = projects.add_project.call({ path: projectRoot });
  const projectArgs = { projectId: project.id, skillRelativePath: "alpha", agent: "claude_code" };
  return { root, store, library, skill, targets, projects, workspace, projectArgs };
}

for (const command of ["update_project_skill_to_center", "import_project_skill_to_center", "import_global_local_skill_to_center"]) {
  test(`${command} 保留其他 Agent 独有文件，继续同步干净目标并返回逐项结果`, async t => {
    const f = await fixture(t);
    f.store.setTags(f.skill.id, ["keep"]);
    f.store.addSkillToPreset(f.skill.id, f.store.presets()[0].id);
    fs.writeFileSync(path.join(f.targets.codex, "local-only.txt"), "unique codex edit");
    let result;
    if (command === "import_global_local_skill_to_center") {
      writeSkill(f.targets.cursor, "global revision");
      result = await f.workspace[command].call({ agent: "cursor", skillRelativePath: "alpha" });
    } else result = await f.projects[command].call(f.projectArgs);
    assert.equal(result.id, f.skill.id);
    assert.deepEqual(result.tags, ["keep"]);
    assert.equal(result.preset_ids.length, 1);
    assert.equal(result.deployments.find(row => row.tool === "codex").status, "failed");
    assert.match(result.deployments.find(row => row.tool === "codex").message, /本地修改.*已保留/);
    assert.equal(result.deployments.find(row => row.tool === "cursor").status, "success");
    assert.equal(fs.readFileSync(path.join(f.targets.codex, "local-only.txt"), "utf8"), "unique codex edit");
    assert.match(fs.readFileSync(path.join(f.targets.codex, "SKILL.md"), "utf8"), /baseline/);
    const revision = command === "import_global_local_skill_to_center" ? /global revision/ : /project revision/;
    assert.match(fs.readFileSync(path.join(f.skill.central_path, "SKILL.md"), "utf8"), revision);
    assert.match(fs.readFileSync(path.join(f.targets.cursor, "SKILL.md"), "utf8"), revision);
    assert.equal(f.store.skill(f.skill.id).targets.find(row => row.tool === "codex").status, "error");
    assert.equal(f.library.snapshots.list().length, 1);
    assert.equal((await f.library.retryDeployments(f.skill.id, ["codex"]))[0].status, "failed");
    assert.equal(fs.readFileSync(path.join(f.targets.codex, "local-only.txt"), "utf8"), "unique codex edit");
  });
}

for (const edit of ["modified", "deleted"]) {
  test(`项目推送保护 Agent 副本中${edit === "modified" ? "改写" : "删除"}的文件`, async t => {
    const f = await fixture(t), localFile = path.join(f.targets.codex, "baseline.txt");
    if (edit === "modified") fs.writeFileSync(localFile, "unique edited bytes");
    else fs.unlinkSync(localFile);
    const result = await f.projects.update_project_skill_to_center.call(f.projectArgs);
    assert.equal(result.deployments.find(row => row.tool === "codex").status, "failed");
    if (edit === "modified") assert.equal(fs.readFileSync(localFile, "utf8"), "unique edited bytes");
    else assert.equal(fs.existsSync(localFile), false);
  });
}

test("中央库更新后部署失败保留旧副本，重试复查新编辑，只重试指定目标", async t => {
  const f = await fixture(t);
  const rename = fs.renameSync;
  t.mock.method(fs, "renameSync", (from, to) => {
    if (to === f.targets.codex && path.basename(String(from)).startsWith(".deploy-") && !String(from).endsWith("-previous")) {
      throw Object.assign(new Error("模拟目标占用"), { code: "EBUSY" });
    }
    return rename(from, to);
  });
  const result = await f.projects.update_project_skill_to_center.call(f.projectArgs);
  t.mock.restoreAll();
  assert.equal(result.deployments.find(row => row.tool === "codex").status, "failed");
  assert.equal(result.deployments.find(row => row.tool === "cursor").status, "success");
  assert.match(fs.readFileSync(path.join(f.targets.codex, "SKILL.md"), "utf8"), /baseline/);
  fs.writeFileSync(path.join(f.targets.codex, "local-only.txt"), "edit during retry");
  assert.equal((await f.library.retryDeployments(f.skill.id, ["codex"]))[0].status, "failed");
  assert.equal(fs.readFileSync(path.join(f.targets.codex, "local-only.txt"), "utf8"), "edit during retry");
  fs.unlinkSync(path.join(f.targets.codex, "local-only.txt"));
  fs.writeFileSync(path.join(f.targets.cursor, "keep.txt"), "do not retry cursor");
  const retried = await f.library.retryDeployments(f.skill.id, ["codex"]);
  assert.deepEqual(retried.map(row => row.tool), ["codex"]);
  assert.equal(retried[0].status, "success");
  assert.match(fs.readFileSync(path.join(f.targets.codex, "SKILL.md"), "utf8"), /project revision/);
  assert.equal(fs.readFileSync(path.join(f.targets.cursor, "keep.txt"), "utf8"), "do not retry cursor");
});

test("已登记的自定义目标路径保持不变，来源副本与新中央库相同可正常同步", async t => {
  const f = await fixture(t), custom = path.join(f.root, "custom-codex", "alpha");
  f.library.undeploy(f.skill.id, "codex");
  await f.library.deploy(f.skill.id, "codex", { destination: custom });
  const result = await f.projects.update_project_skill_to_center.call(f.projectArgs);
  assert.ok(result.deployments.every(row => row.status === "success"));
  assert.equal(f.store.skill(f.skill.id).targets.find(row => row.tool === "codex").target_path, custom);
  assert.equal(fs.existsSync(f.targets.codex), false);
  assert.match(fs.readFileSync(path.join(custom, "SKILL.md"), "utf8"), /project revision/);
});
