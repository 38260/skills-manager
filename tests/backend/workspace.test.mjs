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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manager-workspace-test-"));
  const home = path.join(directory, "home");
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
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

test("global workspace: read, import to center, update from center with protection", async t => {
  const { invoke, home, directory } = await startServer(t);

  const toolSkill = path.join(home, ".codex", "skills", "exported");
  writeSkill(toolSkill, "exported", "工作区技能");
  const nested = path.join(home, ".codex", "skills", "team", "nested-skill");
  writeSkill(nested, "nested-skill", "嵌套技能");

  let locals = (await invoke("get_global_local_skills", { agent: "codex" })).body.data;
  assert.equal(locals.length, 2, "应发现两个工作区技能");
  assert.ok(locals.every(skill => skill.sync_status === "project_only" && skill.in_center === false));

  // 文档读取
  const doc = await invoke("get_global_local_skill_document", { agent: "codex", skillRelativePath: "exported" });
  assert.equal(doc.body.ok, true);
  assert.match(doc.body.data.content, /工作区技能/);
  assert.equal(doc.body.data.skill_name, "exported");

  // 导入到中心：source_ref 匹配后再次读取应显示 in_sync
  const imported = await invoke("import_global_local_skill_to_center", { agent: "codex", skillRelativePath: "exported" });
  assert.equal(imported.body.ok, true, `导入失败：${imported.body.message}`);
  locals = (await invoke("get_global_local_skills", { agent: "codex" })).body.data;
  const exported = locals.find(skill => skill.relative_path === "exported");
  assert.equal(exported.in_center, true, "导入后应匹配中心技能");
  assert.equal(exported.sync_status, "in_sync");

  // 修改工作区副本 → project_newer；从中心更新应被拒绝
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  await sleep(1100);
  fs.writeFileSync(path.join(toolSkill, "SKILL.md"), "---\nname: exported\ndescription: 本地修改版\n---\n本地新增内容\n");
  locals = (await invoke("get_global_local_skills", { agent: "codex" })).body.data;
  assert.equal(locals.find(skill => skill.relative_path === "exported").sync_status, "project_newer");
  const refused = await invoke("update_global_local_skill_from_center", { agent: "codex", skillRelativePath: "exported" });
  assert.equal(refused.body.ok, false, "本地更新时从中心覆盖应被拒绝");
  assert.match(refused.body.message, /本地修改/);

  // 导入到中心把本地修改带回去，之后中心与工作区一致
  await invoke("import_global_local_skill_to_center", { agent: "codex", skillRelativePath: "exported" });
  locals = (await invoke("get_global_local_skills", { agent: "codex" })).body.data;
  assert.equal(locals.find(skill => skill.relative_path === "exported").sync_status, "in_sync");

  // 中心更新 → center_newer；从中心更新成功后恢复一致
  const centerSkillDir = path.join(directory, "skills", "exported");
  await sleep(1100);
  fs.writeFileSync(path.join(centerSkillDir, "NOTES.md"), "中心新增文件\n");
  locals = (await invoke("get_global_local_skills", { agent: "codex" })).body.data;
  assert.equal(locals.find(skill => skill.relative_path === "exported").sync_status, "center_newer");
  const updated = await invoke("update_global_local_skill_from_center", { agent: "codex", skillRelativePath: "exported" });
  assert.equal(updated.body.ok, true, `更新失败：${updated.body.message}`);
  assert.ok(fs.existsSync(path.join(toolSkill, "NOTES.md")), "中心新增文件应同步到工作区");

  // 删除：普通工作区技能可删除（含已入库副本），不存在的路径报错
  const removedSource = await invoke("delete_global_local_skill", { agent: "codex", skillRelativePath: "team/nested-skill" });
  assert.equal(removedSource.body.ok, true);
  assert.ok(!fs.existsSync(nested), "删除后目录应消失");
  const removed = await invoke("delete_global_local_skill", { agent: "codex", skillRelativePath: "exported" });
  assert.equal(removed.body.ok, true);
  assert.ok(!fs.existsSync(toolSkill), "工作区副本删除后目录应消失");
  const missing = await invoke("get_global_local_skill_document", { agent: "codex", skillRelativePath: "exported" });
  assert.equal(missing.body.ok, false);
});
