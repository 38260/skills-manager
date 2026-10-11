import { test } from "node:test";
import assert from "node:assert/strict";
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

function writeSkill(directory, name, description, body = "正文") {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`);
}

async function startServer(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manager-projects-test-"));
  const home = path.join(directory, "home");
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  const store = new Store({ directory, home });
  store.close();
  const port = await freePort();
  const child = spawn(process.execPath, [serverModule, "--port", String(port), "--directory", directory, "--home", home],
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
  return { invoke, directory, home };
}

test("project lifecycle: add, scan, export, toggle, push/pull, delete", async t => {
  const { invoke, directory, home } = await startServer(t);

  // 中心库预置一个技能
  const centerSkill = path.join(directory, "skills", "reporter");
  writeSkill(centerSkill, "reporter", "中心技能");
  const store = new Store({ directory, home });
  const now = Date.now();
  store.run("INSERT INTO skills(id,name,description,source_type,central_path,content_hash,enabled,created_at,updated_at,status,update_status) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    "skill-center", "reporter", "中心技能", "import", centerSkill, null, true, now, now, "ok", "local_only");
  store.close();

  // 项目目录含 .claude/skills（模拟已有内容），另一个子目录用于扫描测试
  const projectRoot = path.join(directory, "workspaces", "demo");
  writeSkill(path.join(projectRoot, ".claude", "skills", "local-only"), "local-only", "项目独有");
  const sibling = path.join(directory, "workspaces", "sibling");
  writeSkill(path.join(sibling, ".claude", "skills", "sib"), "sib", "兄弟项目");

  const added = await invoke("add_project", { path: projectRoot });
  assert.equal(added.body.ok, true, `add_project 失败：${added.body.message}`);
  const projectId = added.body.data.id;
  assert.equal(added.body.data.name, "demo");
  assert.equal(added.body.data.skill_count, 1);

  const duplicate = await invoke("add_project", { path: projectRoot });
  assert.equal(duplicate.body.ok, false, "重复添加应报错");

  // 扫描发现两个候选项目
  const scanned = await invoke("scan_projects", { root: path.join(directory, "workspaces") });
  assert.equal(scanned.body.ok, true);
  assert.equal(scanned.body.data.length, 2, "扫描应发现 demo 与 sibling");
  assert.ok(scanned.body.data.some(item => item === projectRoot));

  // Agent 目标：codex 与 claude_code 均列出
  const targets = (await invoke("get_project_agent_targets", { projectId })).body.data;
  assert.ok(targets.some(target => target.key === "claude_code"));
  assert.ok(targets.some(target => target.key === "codex"));

  // 项目导出/停用/推送拉取在 copy 模式下验证（junction 模式下项目与中心同源，push/pull 不适用）
  assert.equal((await invoke("set_settings", { key: "sync_mode", value: "copy" })).body.ok, true);

  // 从中心导出到项目（claude_code）→ in_sync
  const exported = await invoke("export_skill_to_project", { skillId: "skill-center", projectId, agents: ["claude_code"] });
  assert.equal(exported.body.ok, true, `导出失败：${exported.body.message}`);
  let skills = (await invoke("get_project_skills", { projectId })).body.data;
  assert.equal(skills.length, 2);
  assert.equal(skills.find(skill => skill.relative_path === "reporter").sync_status, "in_sync");
  assert.equal(skills.find(skill => skill.relative_path === "local-only").sync_status, "project_only");

  // 重复导出被拒绝
  const conflict = await invoke("export_skill_to_project", { skillId: "skill-center", projectId, agents: ["claude_code"] });
  assert.equal(conflict.body.ok, false, "重复导出应报目录冲突");

  // 启用开关：停用后进入 skills-disabled
  const toggled = await invoke("toggle_project_skill", { projectId, skillRelativePath: "reporter", agent: "claude_code", enabled: false });
  assert.equal(toggled.body.ok, true, `停用失败：${toggled.body.message}`);
  assert.ok(fs.existsSync(path.join(projectRoot, ".claude", "skills-disabled", "reporter")), "停用后应移动到 skills-disabled");
  skills = (await invoke("get_project_skills", { projectId })).body.data;
  assert.equal(skills.find(skill => skill.relative_path === "reporter").enabled, false);
  await invoke("toggle_project_skill", { projectId, skillRelativePath: "reporter", agent: "claude_code", enabled: true });
  assert.ok(fs.existsSync(path.join(projectRoot, ".claude", "skills", "reporter")), "启用后应移回 skills");

  // 项目修改 → project_newer；推送中心后一致
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  await sleep(1100);
  fs.writeFileSync(path.join(projectRoot, ".claude", "skills", "reporter", "NOTES.md"), "项目修改\n");
  skills = (await invoke("get_project_skills", { projectId })).body.data;
  assert.equal(skills.find(skill => skill.relative_path === "reporter").sync_status, "project_newer");
  const refused = await invoke("update_project_skill_from_center", { projectId, skillRelativePath: "reporter", agent: "claude_code" });
  assert.equal(refused.body.ok, false, "项目更新时从中心拉取应被拒绝");
  const pushed = await invoke("update_project_skill_to_center", { projectId, skillRelativePath: "reporter", agent: "claude_code" });
  assert.equal(pushed.body.ok, true, `推送失败：${pushed.body.message}`);

  // 中心更新 → 拉取到项目
  await sleep(1100);
  fs.writeFileSync(path.join(centerSkill, "CENTER.md"), "中心新增\n");
  skills = (await invoke("get_project_skills", { projectId })).body.data;
  assert.equal(skills.find(skill => skill.relative_path === "reporter").sync_status, "center_newer");
  const pulled = await invoke("update_project_skill_from_center", { projectId, skillRelativePath: "reporter", agent: "claude_code" });
  assert.equal(pulled.body.ok, true, `拉取失败：${pulled.body.message}`);
  assert.ok(fs.existsSync(path.join(projectRoot, ".claude", "skills", "reporter", "CENTER.md")));

  // 项目技能导入为新的中心技能
  const imported = await invoke("import_project_skill_to_center", { projectId, skillRelativePath: "local-only", agent: "claude_code" });
  assert.equal(imported.body.ok, true, `导入失败：${imported.body.message}`);
  const managed = (await invoke("get_managed_skills", {})).body.data;
  assert.ok(managed.some(skill => skill.name === "local-only"), "项目独有技能应入库");

  // 删除项目技能与项目本身
  const deleted = await invoke("delete_project_skill", { projectId, skillRelativePath: "local-only", agent: "claude_code" });
  assert.equal(deleted.body.ok, true);
  assert.ok(!fs.existsSync(path.join(projectRoot, ".claude", "skills", "local-only")));
  const removed = await invoke("remove_project", { id: projectId });
  assert.equal(removed.body.ok, true);
  assert.equal(((await invoke("get_projects", {})).body.data).length, 0, "移除后项目列表为空");
  // 移除项目不删除磁盘内容
  assert.ok(fs.existsSync(path.join(projectRoot, ".claude", "skills", "reporter")));
});

test("linked workspace: add with disabled dir, read skills, duplicate roots rejected", async t => {
  const { invoke, directory } = await startServer(t);

  const root = path.join(directory, "linked", "skills");
  const disabled = path.join(directory, "linked", "skills-disabled");
  writeSkill(path.join(root, "alpha"), "alpha", "启用");
  writeSkill(path.join(disabled, "beta"), "beta", "停用");

  const added = await invoke("add_linked_workspace", { name: "Linked Hub", path: root, disabledPath: disabled });
  assert.equal(added.body.ok, true, `添加失败：${added.body.message}`);
  assert.equal(added.body.data.workspace_type, "linked");
  assert.equal(added.body.data.supports_skill_toggle, true);

  const skills = (await invoke("get_project_skills", { projectId: added.body.data.id })).body.data;
  assert.equal(skills.length, 2);
  assert.equal(skills.find(skill => skill.name === "alpha").enabled, true);
  assert.equal(skills.find(skill => skill.name === "beta").enabled, false);

  const overlap = await invoke("add_linked_workspace", { name: "Bad", path: root, disabledPath: root });
  assert.equal(overlap.body.ok, false, "重叠目录应被拒绝");
});
