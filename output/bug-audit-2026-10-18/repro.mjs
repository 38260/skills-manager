// 审查证据：断言当前缺陷确实存在，不是产品应满足的回归断言。
// 所有数据均在本次创建的临时目录内；不访问真实技能库或外部 Git 服务。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";
import { backupCommands } from "../../backend/backup.mjs";
import { projectCommands } from "../../backend/projects.mjs";
import { skillOperationCommands } from "../../backend/skill-operations.mjs";
import { hashDirectory } from "../../backend/files.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manager-audit-"));
const stores = new Set();
const results = [];
const writeSkill = (directory, name, body) => {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "SKILL.md"), `---\nname: ${name}\n---\n${body}\n`);
};
function fixture(name) {
  const base = path.join(root, name);
  const home = path.join(base, "home");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  const directory = path.join(base, "app");
  const store = new Store({ directory, home });
  stores.add(store);
  store.setSetting("sync_mode", "copy");
  const library = new Library(store);
  skillOperationCommands(library);
  return { base, home, directory, store, library, backup: backupCommands(store), projects: projectCommands(store, library) };
}
function close(store) { store.close(); stores.delete(store); }
function record(id, evidence) { results.push({ id, reproduced: true, evidence }); }

try {
  // B1：恢复 Git 文件树后，数据库仍是恢复前的清单与用户属性。
  {
    const f = fixture("restore");
    const source = path.join(f.base, "source");
    writeSkill(source, "alpha", "version one");
    const alpha = await f.library.installLocal(source);
    const preset = f.store.createPreset("Audit", null, null);
    f.store.addSkillToPreset(alpha.id, preset.id);
    f.store.setTags(alpha.id, ["before"]);
    f.store.setProfile(alpha.id, { alias: "before" });
    await f.backup.git_backup_init.call({});
    const tag = await f.backup.git_backup_create_snapshot.call({});
    f.store.setTags(alpha.id, ["after"]);
    f.store.setProfile(alpha.id, { alias: "after" });
    f.store.removeSkillFromPreset(alpha.id, preset.id);
    const betaSource = path.join(f.base, "beta-source");
    writeSkill(betaSource, "beta", "created after snapshot");
    const beta = await f.library.installLocal(betaSource);
    await f.backup.git_backup_restore_version.call({ tag });
    const restoredMeta = JSON.parse(fs.readFileSync(path.join(f.store.skillsDirectory, ".skills-manager", "skills", `${alpha.id}.json`), "utf8"));
    assert.equal(restoredMeta.alias, "before");
    assert.equal(f.store.skill(alpha.id).alias, "after");
    assert.equal(f.store.skillsForPreset(preset.id).length, 0);
    assert.equal(fs.existsSync(beta.central_path), false);
    assert.ok(f.store.skills().some(skill => skill.id === beta.id));
    close(f.store);
    const reopened = new Store({ directory: f.directory, home: f.home }); stores.add(reopened);
    assert.equal(reopened.skill(alpha.id).alias, "after");
    assert.ok(reopened.skills().some(skill => skill.id === beta.id));
    record("B1", { fileAlias: restoredMeta.alias, databaseAliasAfterRestart: reopened.skill(alpha.id).alias, missingDirectoryStillListed: true, presetMembersAfterRestore: reopened.skillsForPreset(preset.id).length });
  }
  // B2：新设备克隆后，当前进程不纳管；重启只恢复技能与空 Preset。
  {
    const source = fixture("clone-source"), destination = fixture("clone-destination");
    const input = path.join(source.base, "input");
    writeSkill(input, "clone-alpha", "portable skill");
    const skill = await source.library.installLocal(input);
    const preset = source.store.createPreset("Portable", null, null);
    source.store.addSkillToPreset(skill.id, preset.id);
    source.store.setScenarioSkillTool(preset.id, skill.id, "codex", false);
    await source.backup.git_backup_init.call({});
    await destination.backup.git_backup_clone.call({ url: source.store.skillsDirectory, setAside: [] });
    const membership = path.join(destination.store.skillsDirectory, ".skills-manager", "scenario-skills", preset.id, `${skill.id}.json`);
    assert.ok(fs.existsSync(membership));
    const immediateCount = destination.store.skills().length;
    assert.equal(immediateCount, 0);
    close(destination.store);
    const reopened = new Store({ directory: destination.directory, home: destination.home }); stores.add(reopened);
    assert.equal(reopened.skills().length, 1);
    assert.ok(reopened.presets().some(item => item.id === preset.id));
    assert.equal(reopened.skillsForPreset(preset.id).length, 0);
    assert.equal(reopened.all("SELECT * FROM scenario_skill_tools").length, 0);
    record("B2", { membershipFilePresent: true, immediateSkillCount: immediateCount, restartedSkillCount: reopened.skills().length, restoredPresetMembers: 0, restoredAgentSwitches: 0 });
  }
  // B3：同名启用/停用副本同时存在，启用会直接删除停用副本。
  {
    const f = fixture("toggle");
    const enabled = path.join(f.base, "enabled"), disabled = path.join(f.base, "disabled");
    writeSkill(path.join(enabled, "alpha"), "alpha", "enabled version");
    writeSkill(path.join(disabled, "alpha"), "alpha", "unique disabled version");
    const project = f.projects.add_linked_workspace.call({ name: "Audit", path: enabled, disabledPath: disabled });
    const agent = f.store.project(project.id).linked_agent_key;
    f.projects.toggle_project_skill.call({ projectId: project.id, skillRelativePath: "alpha", agent, enabled: false });
    assert.ok(fs.existsSync(path.join(enabled, "alpha")));
    assert.ok(fs.existsSync(path.join(disabled, "alpha")));
    f.projects.toggle_project_skill.call({ projectId: project.id, skillRelativePath: "alpha", agent, enabled: true });
    assert.equal(fs.existsSync(path.join(disabled, "alpha")), false);
    assert.match(fs.readFileSync(path.join(enabled, "alpha", "SKILL.md"), "utf8"), /enabled version/);
    record("B3", { successReturned: true, disableLeftEnabledCopy: true, disabledUniqueCopyDeleted: true });
  }
  // B4：项目推送到中央库，会强制覆盖另一个 Agent 的已编辑部署副本。
  {
    const f = fixture("push");
    const source = path.join(f.base, "input");
    writeSkill(source, "alpha", "baseline");
    const skill = await f.library.installLocal(source);
    await f.library.deploy(skill.id, "codex");
    const target = f.store.skill(skill.id).targets[0].target_path;
    fs.writeFileSync(path.join(target, "local-only.txt"), "unique user edit");
    const projectRoot = path.join(f.base, "project");
    writeSkill(path.join(projectRoot, ".claude", "skills", "alpha"), "alpha", "project revision");
    const project = f.projects.add_project.call({ path: projectRoot });
    await f.projects.update_project_skill_to_center.call({ projectId: project.id, skillRelativePath: "alpha", agent: "claude_code" });
    assert.equal(fs.existsSync(path.join(target, "local-only.txt")), false);
    assert.match(fs.readFileSync(path.join(target, "SKILL.md"), "utf8"), /project revision/);
    const snapshots = f.library.snapshots.list();
    assert.equal(snapshots.length, 1);
    assert.equal(f.library.snapshots.read(snapshots[0].snapshot_id).record.entries.some(entry => entry.path === "local-only.txt"), false);
    record("B4", { editedAgentCopyOverwritten: true, uniqueFileInSnapshot: false });
  }
  // B5：第二个目标冲突时，首个目标已写入；整个命令仍报错。
  {
    const f = fixture("export");
    const source = path.join(f.base, "input");
    writeSkill(source, "alpha", "center revision");
    const skill = await f.library.installLocal(source);
    const projectRoot = path.join(f.base, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = f.projects.add_project.call({ path: projectRoot });
    writeSkill(path.join(projectRoot, ".codex", "skills", "alpha"), "alpha", "existing codex version");
    assert.throws(() => f.projects.export_skill_to_project.call({ projectId: project.id, skillId: skill.id, agents: ["claude_code", "codex"] }), /已存在/);
    assert.ok(fs.existsSync(path.join(projectRoot, ".claude", "skills", "alpha", "SKILL.md")));
    assert.match(fs.readFileSync(path.join(projectRoot, ".codex", "skills", "alpha", "SKILL.md"), "utf8"), /existing codex version/);
    record("B5", { requestFailed: true, firstAgentWritten: true, secondAgentUnchanged: true });
  }
  // B6：只改文件名不会改变缓存指纹，列表继续显示 in_sync。
  {
    const f = fixture("cache");
    const source = path.join(f.base, "input");
    writeSkill(source, "alpha", "baseline");
    fs.writeFileSync(path.join(source, "a.txt"), "reference");
    const skill = await f.library.installLocal(source);
    const projectRoot = path.join(f.base, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = f.projects.add_project.call({ path: projectRoot });
    f.projects.export_skill_to_project.call({ projectId: project.id, skillId: skill.id, agents: ["claude_code"] });
    const before = f.projects.get_project_skills.call({ projectId: project.id });
    assert.equal(before[0].sync_status, "in_sync");
    const target = path.join(projectRoot, ".claude", "skills", "alpha");
    fs.renameSync(path.join(target, "a.txt"), path.join(target, "b.txt"));
    const after = f.projects.get_project_skills.call({ projectId: project.id });
    assert.notEqual(hashDirectory(target), hashDirectory(skill.central_path));
    assert.equal(after[0].sync_status, "in_sync");
    record("B6", { realContentsDiffer: true, reportedSyncStatus: after[0].sync_status });
  }
  // B7：畸形 URL 的百分号解码抛错，整个本地服务退出。
  {
    const f = fixture("http"); close(f.store);
    const probe = http.createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
    const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    const entry = fileURLToPath(new URL("../../backend/server.mjs", import.meta.url));
    const child = spawn(process.execPath, [entry, "--port", String(port), "--directory", f.directory, "--home", f.home], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", () => {}); let stderr = ""; child.stderr.on("data", chunk => { stderr += chunk; });
    const exit = once(child, "exit");
    try {
      const deadline = Date.now() + 10000;
      for (;;) {
        try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch {}
        if (Date.now() > deadline || child.exitCode !== null) throw new Error("隔离 HTTP 服务未就绪");
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      await fetch(`http://127.0.0.1:${port}/%ZZ`, { signal: AbortSignal.timeout(3000) }).catch(() => {});
      const [code] = await Promise.race([exit, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("服务未退出")), 3000); timer.unref(); })]);
      assert.equal(code, 1); assert.match(stderr, /URIError: URI malformed/);
      record("B7", { requestPath: "/%ZZ", serverExitCode: code, error: "URIError: URI malformed" });
    } finally {
      if (child.exitCode === null) { child.kill(); await exit; }
    }
  }
  console.log(JSON.stringify({ results, cleanup: "所有隔离数据在 finally 中清理" }, null, 2));
} finally {
  for (const store of stores) store.close();
  // 只删除本脚本通过 mkdtemp 创建的确切目录，并再次校验边界。
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith("skills-manager-audit-"));
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
