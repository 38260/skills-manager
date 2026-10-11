import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Store } from "../../backend/store.mjs";

const serverModule = fileURLToPath(new URL("../../backend/server.mjs", import.meta.url));

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
    probe.on("error", reject);
  });
}

function git(cwd, args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true });
  } catch (error) {
    throw new Error(`git ${args.join(" ")} 失败：${error.stderr || error.message}`);
  }
}

function writeSkill(directory, name, body) {
  fs.mkdirSync(path.join(directory, name), { recursive: true });
  fs.writeFileSync(path.join(directory, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} 技能\n---\n${body}\n`);
}

async function startServer(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manager-backup-test-"));
  const home = path.join(directory, "home");
  fs.mkdirSync(home, { recursive: true });
  const repoDirectory = path.join(directory, "repo");
  const port = await freePort();
  const child = spawn(process.execPath, [serverModule, "--port", String(port), "--directory", repoDirectory, "--home", home],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  const invoke = async (command, args) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/invoke/${command}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-skills-manager-client": "webview" },
      body: JSON.stringify(args ?? {}),
    });
    return { status: response.status, body: await response.json() };
  };
  const deadline = Date.now() + 10000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch {}
    if (Date.now() > deadline || child.exitCode !== null) {
      child.kill();
      throw new Error(`本地服务未在期限内就绪。stderr：${stderr}`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once("exit", resolve));
      child.kill();
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
    }
    try { fs.rmSync(directory, { recursive: true, force: true }); }
    catch (error) { console.warn(`测试目录清理失败（可手动删除）：${directory}，原因：${error.message}`); }
  });
  return { invoke, directory, skillsDir: path.join(repoDirectory, "skills") };
}

test("backup lifecycle: init, sync, snapshot, versions, restore", async t => {
  const { invoke, directory, skillsDir } = await startServer(t);

  let status = (await invoke("git_backup_status", {})).body.data;
  assert.equal(status.is_repo, false);

  writeSkill(skillsDir, "alpha", "第一版");
  // 为 alpha 建立数据库记录，使分类标签可以挂载
  const seedStore = new Store({ directory: path.join(directory, "repo"), home: path.join(directory, "home") });
  const now = Date.now();
  seedStore.run("INSERT INTO skills(id,name,description,source_type,central_path,content_hash,enabled,created_at,updated_at,status,update_status) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    "skill-alpha", "alpha", "alpha 技能", "import", path.join(skillsDir, "alpha"), null, true, now, now, "ok", "local_only");
  seedStore.close();
  assert.equal((await invoke("git_backup_init", {})).body.ok, true);
  // 给技能打分类标签：随 .skills-manager 元数据入库，恢复后应保留
  await invoke("set_skill_tags", { skillId: "skill-alpha", tags: ["测试分类"] });
  await invoke("git_backup_commit", { message: "分类标签" });
  status = (await invoke("git_backup_status", {})).body.data;
  assert.equal(status.is_repo, true);
  assert.equal(status.has_changes, false, "初始化提交后应无待备份改动");

  const outcome = (await invoke("git_backup_sync", { message: "手动备份" })).body.data;
  assert.equal(outcome.committed, false);
  assert.equal(outcome.pushed, false, "无远端时不推送");
  assert.match(outcome.snapshot_tag, /^sm-v-\d{8}-\d{6}-[0-9a-f]+$/);

  // 有改动时同步产生提交与快照
  writeSkill(skillsDir, "beta", "新增技能");
  const outcome2 = (await invoke("git_backup_sync", { message: "新增 beta" })).body.data;
  assert.equal(outcome2.committed, true);

  const versions = (await invoke("git_backup_list_versions", { limit: 50 })).body.data;
  assert.ok(versions.length >= 2, "应有两个快照版本");
  assert.match(versions[0].tag, /^sm-v-/);

  // 恢复到第一个版本：beta 移除，返回安全点 tag
  const firstTag = versions[versions.length - 1].tag;
  const safety = (await invoke("git_backup_restore_version", { tag: firstTag })).body.data;
  assert.match(safety, /^sm-v-/);
  assert.ok(!fs.existsSync(path.join(skillsDir, "beta")), "恢复后应回到第一版内容");
  assert.ok(fs.existsSync(path.join(skillsDir, "alpha")), "alpha 保留");
  // 分类关联随 .skills-manager 元数据一并恢复
  const restoredSkills = (await invoke("get_managed_skills", {})).body.data;
  assert.deepEqual(restoredSkills[0].tags, ["测试分类"], "恢复后分类标签应保留");

  const report = (await invoke("git_backup_size_report", {})).body.data;
  assert.ok(report.total_bytes > 0);
  assert.equal(report.skill_limit_bytes, 100 * 1024 * 1024);
});

test("two-device sync with conflict resolution and clone guard", async t => {
  const { invoke, directory, skillsDir } = await startServer(t);

  // 设备一：初始化并推送到裸远端
  writeSkill(skillsDir, "shared", "原始内容");
  await invoke("git_backup_init", {});
  const remote = path.join(directory, "remote.git");
  git(path.join(directory, "repo", "skills"), ["init", "--bare", "-b", "main", remote]);
  const remoteUrl = `file://${remote.replace(/\\/g, "/")}`;
  await invoke("git_backup_set_remote", { url: remoteUrl });
  const pushed = (await invoke("git_backup_sync", { message: "首份备份" })).body.data;
  assert.equal(pushed.pushed, true, `推送失败：${pushed.snapshot_tag}`);

  // 设备二：干净克隆远端内容（repo-config.json 须位于 <home>/.skills-manager/）
  const dir2 = path.join(directory, "device2");
  fs.mkdirSync(path.join(dir2, ".skills-manager"), { recursive: true });
  fs.writeFileSync(path.join(dir2, ".skills-manager", "repo-config.json"), JSON.stringify({ repo_path: path.join(dir2, "repo") }));
  const store2 = new Store({ home: dir2 });
  store2.close();
  const { backupCommands } = await import("../../backend/backup.mjs");
  const device2 = backupCommands(new Store({ home: dir2 }), () => {});
  // Store 读取 repo-config 的 repo_path，需要目录存在：clone 命令自己建
  await device2.git_backup_clone.call({ url: remoteUrl, setAside: [] });
  assert.ok(fs.existsSync(path.join(dir2, "repo", "skills", "shared", "SKILL.md")), "克隆后技能应存在");

  // 设备二修改并推送
  fs.writeFileSync(path.join(dir2, "repo", "skills", "shared", "SKILL.md"), "---\nname: shared\n---\n设备二修改\n");
  const pushed2 = await device2.git_backup_sync.call({ message: "设备二修改" });
  assert.equal(pushed2.pushed, true);

  // 设备一本地也修改 → 同步产生冲突
  fs.writeFileSync(path.join(skillsDir, "shared", "SKILL.md"), "---\nname: shared\n---\n设备一修改\n");
  const conflict = await invoke("git_backup_sync", { message: "设备一修改" });
  assert.equal(conflict.body.ok, false);
  assert.match(conflict.body.message, /SYNC_CONFLICT|CONFLICT/);
  const conflicts = (await invoke("git_backup_pending_conflicts", {})).body.data;
  assert.equal(conflicts.length, 1, "应记录一条待解决冲突");

  // keep_local 解决后可继续同步推送
  const resolved = await invoke("git_backup_resolve_conflict", { skillId: conflicts[0].skill_id, action: "keep_local" });
  assert.equal(resolved.body.ok, true, `解决失败：${resolved.body.message}`);
  assert.equal(((await invoke("git_backup_pending_conflicts", {})).body.data).length, 0);
  const finalSync = await invoke("git_backup_sync", { message: "解决冲突后同步" });
  assert.equal(finalSync.body.ok, true, `解决后同步失败：${finalSync.body.message}`);
  assert.equal(finalSync.body.data.pushed, true);
  assert.match(fs.readFileSync(path.join(skillsDir, "shared", "SKILL.md"), "utf8"), /设备一修改/, "keep_local 保留本地内容");

  // use_remote 与 keep_both 动作：设备二先对齐设备一推送的历史，再改出新的分歧
  await device2.git_backup_sync.call({ message: "设备二对齐" });
  fs.writeFileSync(path.join(dir2, "repo", "skills", "shared", "SKILL.md"), "---\nname: shared\n---\n设备二再改\n");
  await device2.git_backup_sync.call({ message: "设备二再改" });
  fs.writeFileSync(path.join(skillsDir, "shared", "SKILL.md"), "---\nname: shared\n---\n设备一又改\n");
  await invoke("git_backup_sync", { message: "设备一又改" }).catch(() => {});
  const conflicts2 = (await invoke("git_backup_pending_conflicts", {})).body.data;
  if (conflicts2.length) {
    const useRemote = await invoke("git_backup_resolve_conflict", { skillId: conflicts2[0].skill_id, action: "use_remote" });
    assert.equal(useRemote.body.ok, true, `use_remote 失败：${useRemote.body.message}`);
    assert.match(fs.readFileSync(path.join(skillsDir, "shared", "SKILL.md"), "utf8"), /设备二再改/, "use_remote 采用远端内容");
    await invoke("git_backup_sync", { message: "对齐远端" });
  }

  // 克隆保护：独立远端含同名但内容不同的技能 → 报 CLONE_LOCAL_DIFFERS；确认后 setAside 保留本地副本
  const remote2 = path.join(directory, "remote2.git");
  const seed = path.join(directory, "seed");
  fs.mkdirSync(seed, { recursive: true });
  git(seed, ["init", "-b", "main"]);
  git(seed, ["config", "user.email", "seed@test"]);
  git(seed, ["config", "user.name", "seed"]);
  fs.mkdirSync(path.join(seed, "shared"), { recursive: true });
  fs.writeFileSync(path.join(seed, "shared", "SKILL.md"), "---\nname: shared\n---\n远端独有内容\n");
  git(seed, ["add", "-A"]);
  git(seed, ["commit", "-m", "远端初始"]);
  git(seed, ["init", "--bare", "-b", "main", remote2]);
  git(seed, ["remote", "add", "origin", `file://${remote2.replace(/\\/g, "/")}`]);
  git(seed, ["push", "-u", "origin", "main"]);
  const remote2Url = `file://${remote2.replace(/\\/g, "/")}`;

  const dir3 = path.join(directory, "device3");
  fs.mkdirSync(path.join(dir3, ".skills-manager"), { recursive: true });
  fs.writeFileSync(path.join(dir3, ".skills-manager", "repo-config.json"), JSON.stringify({ repo_path: path.join(dir3, "repo") }));
  writeSkill(path.join(dir3, "repo", "skills"), "shared", "本地独有版本");
  const device3 = backupCommands(new Store({ home: dir3 }), () => {});
  const diff = await device3.git_backup_clone.call({ url: remote2Url, setAside: null }).catch(error => error);
  assert.match(String(diff.message), /CLONE_LOCAL_DIFFERS/);
  assert.match(String(diff.message), /copies:\nshared$/);
  const kept = await device3.git_backup_clone.call({ url: remote2Url, setAside: ["shared"] });
  assert.ok(kept, "setAside 后应返回本地副本保存路径");
  assert.match(fs.readFileSync(path.join(dir3, "repo", "skills", "shared", "SKILL.md"), "utf8"), /远端独有内容/, "克隆后采用远端内容");
  assert.match(fs.readFileSync(path.join(kept, "shared", "SKILL.md"), "utf8"), /本地独有版本/, "本地版本保留在副本目录");
});
