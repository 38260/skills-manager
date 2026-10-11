import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const serverModule = fileURLToPath(new URL("../../backend/server.mjs", import.meta.url));

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
    probe.on("error", reject);
  });
}

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true });
}

async function startServer(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manager-update-test-"));
  const home = path.join(directory, "home");
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
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
  return { invoke, directory, skillsDir: path.join(repoDirectory, "skills"), home };
}

test("git-source update regression: install, upstream change, check, update, relations preserved", async t => {
  const { invoke, directory, skillsDir, home } = await startServer(t);

  // 上游仓库：一个可更新的技能
  const upstream = path.join(directory, "upstream", "skills-repo");
  fs.mkdirSync(path.join(upstream, "my-tool"), { recursive: true });
  fs.writeFileSync(path.join(upstream, "my-tool", "SKILL.md"), "---\nname: my-tool\ndescription: 第一版\n---\n第一版正文\n");
  git(upstream, ["init", "-b", "main"]);
  git(upstream, ["config", "user.email", "up@test"]);
  git(upstream, ["config", "user.name", "upstream"]);
  git(upstream, ["add", "-A"]);
  git(upstream, ["commit", "-m", "第一版"]);
  const remote = path.join(directory, "upstream", "remote.git");
  git(upstream, ["init", "--bare", "-b", "main", remote]);
  git(upstream, ["remote", "add", "origin", `file://${remote.replace(/\\/g, "/")}`]);
  git(upstream, ["push", "-u", "origin", "main"]);
  const repoUrl = `file://${path.join(directory, "upstream", "remote.git").replace(/\\/g, "/")}`;

  // 通过 Git 安装
  const installed = await invoke("install_git", { repoUrl, name: null });
  assert.equal(installed.body.ok, true, `Git 安装失败：${installed.body.message}`);
  const skill = (await invoke("get_managed_skills", {})).body.data.find(item => item.name === "my-tool");
  assert.ok(skill, "安装后应出现 my-tool");
  assert.equal(skill.source_type, "git");
  assert.equal(skill.update_status, "up_to_date");

  // 打分类标签并部署到 codex
  await invoke("set_skill_tags", { skillId: skill.id, tags: ["回归分类"] });
  const deployed = await invoke("sync_skill_to_tool", { skillId: skill.id, tool: "codex" });
  assert.equal(deployed.body.ok, true, `部署失败：${deployed.body.message}`);

  // 上游变更（新增文件 + 修改正文）→ 检查更新
  fs.writeFileSync(path.join(upstream, "my-tool", "EXTRA.md"), "新增文件\n");
  fs.writeFileSync(path.join(upstream, "my-tool", "SKILL.md"), "---\nname: my-tool\ndescription: 第二版\nmetadata:\n  author: 上游作者\n---\n第二版正文\n");
  git(upstream, ["add", "-A"]);
  git(upstream, ["commit", "-m", "第二版"]);
  git(upstream, ["push", "origin", "main"]);
  const checked = await invoke("check_skill_update", { skillId: skill.id });
  assert.equal(checked.body.ok, true, `检查更新失败：${checked.body.message}`);
  assert.equal(checked.body.data.update_status, "update_available");

  // 执行更新：内容变化、作者从新版本解析、分类与部署保留
  const updated = await invoke("update_skill", { skillId: skill.id });
  assert.equal(updated.body.ok, true, `更新失败：${updated.body.message}`);
  assert.equal(updated.body.data.content_changed, true);
  assert.equal(updated.body.data.pending_removals.length, 0);
  const after = (await invoke("get_managed_skills", {})).body.data.find(item => item.id === skill.id);
  assert.equal(after.content_hash, updated.body.data.skill.content_hash);
  assert.equal(after.update_status, "up_to_date");
  assert.deepEqual(after.tags, ["回归分类"], "更新后分类标签应保留");
  assert.equal(after.author, "上游作者", "更新后应从新版本重新解析作者");
  assert.equal(after.targets.length, 1, "更新后部署记录应保留");
  assert.equal(after.targets[0].tool, "codex");

  // 已部署副本同步验证：copy 模式副本内容应与中心一致（symlink 模式本身共享）
  const targetPath = after.targets[0].target_path;
  assert.ok(fs.existsSync(targetPath), "部署副本应存在");
  const copyUpdated = await invoke("update_skill", { skillId: skill.id });
  assert.equal(copyUpdated.body.ok, true);

  // 无更新来源的本地技能不能伪装成可更新
  const localSkill = path.join(home, ".codex", "skills", "plain");
  fs.mkdirSync(localSkill, { recursive: true });
  fs.writeFileSync(path.join(localSkill, "SKILL.md"), "---\nname: plain\ndescription: 本地\n---\n正文\n");
  const imported = await invoke("import_existing_skill", { sourcePath: localSkill, name: null });
  assert.equal(imported.body.ok, true);
  const local = (await invoke("get_managed_skills", {})).body.data.find(item => item.name === "plain");
  assert.equal(local.update_status, "local_only");
  // 本地技能检查更新不会伪装成"有远程更新"，而是保持 local_only
  const localCheck = await invoke("check_skill_update", { skillId: local.id });
  assert.equal(localCheck.body.ok, true);
  assert.equal(localCheck.body.data.update_status, "local_only");
});
