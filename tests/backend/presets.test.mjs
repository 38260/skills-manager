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

// 预置一个技能与一个可检测的工具目录（.codex），使部署目标可验证。
function seed(directory) {
  const skillDirectory = path.join(directory, "skills", "example");
  fs.mkdirSync(skillDirectory, { recursive: true });
  fs.writeFileSync(path.join(skillDirectory, "SKILL.md"), "---\nname: example\ndescription: 测试技能\n---\n正文\n");
  fs.mkdirSync(path.join(directory, "home", ".codex"), { recursive: true });
  const store = new Store({ directory, home: path.join(directory, "home") });
  const now = Date.now();
  store.run("INSERT INTO skills(id,name,description,source_type,central_path,content_hash,enabled,created_at,updated_at,status,update_status) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    "skill-1", "example", "测试技能", "import", skillDirectory, "seed-hash", true, now, now, "ok", "local_only");
  store.close();
}

async function startServer(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manager-preset-test-"));
  seed(directory);
  const port = await freePort();
  const child = spawn(process.execPath, [serverModule, "--port", String(port), "--directory", directory, "--home", path.join(directory, "home")],
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
  return { invoke };
}

test("preset lifecycle: create, rename, duplicate guard, order, delete", async t => {
  const { invoke } = await startServer(t);

  const created = await invoke("create_preset", { name: "工作台", description: "日常技能", icon: null });
  assert.equal(created.body.ok, true);
  const presetId = created.body.data.id;

  const renamed = await invoke("update_preset", { id: presetId, name: "写作台", description: null, icon: "pen" });
  assert.equal(renamed.body.ok, true);
  assert.equal(renamed.body.data.name, "写作台");

  const duplicate = await invoke("create_preset", { name: "写作台" });
  assert.equal(duplicate.body.ok, false);
  assert.match(duplicate.body.message, /同名/);

  const second = await invoke("create_preset", { name: "第二个" });
  assert.equal(second.body.ok, true);
  // Store 初始化时自带一个 Default Preset，重排需覆盖完整列表。
  const before = (await invoke("get_presets", {})).body.data.map(item => item.id);
  const wanted = [second.body.data.id, presetId];
  const reorder = await invoke("reorder_presets", { ids: [...wanted, ...before.filter(id => !wanted.includes(id))] });
  assert.equal(reorder.body.ok, true);
  const presets = await invoke("get_presets", {});
  assert.deepEqual(presets.body.data.map(item => item.id), wanted.concat(before.filter(id => !wanted.includes(id))));

  const emptyOrder = await invoke("get_preset_skill_order", { presetId });
  assert.deepEqual(emptyOrder.body.data, []);

  const deleted = await invoke("delete_preset", { id: presetId });
  assert.equal(deleted.body.ok, true);
  const after = await invoke("get_presets", {});
  assert.equal(after.body.data.some(item => item.id === presetId), false);
});

// 自 v1.16 起没有「应用 Preset」命令：部署由工作区按技能即时同步完成，
// 旧测试调用的 apply_preset_to_default / get_active_preset 已不存在。
// 这里改按现行语义验证同一件事：同步到工具会产生部署记录，撤销后不残留目标。
test("技能同步到工具产生部署记录，撤销后清空目标，Preset 开关独立落库", async t => {
  const { invoke } = await startServer(t);

  const preset = await invoke("create_preset", { name: "部署场景" });
  const presetId = preset.body.data.id;
  await invoke("add_skill_to_preset", { skillId: "skill-1", presetId });

  // 成员排序：先加入也允许重排。
  await invoke("reorder_preset_skills", { presetId, skillIds: ["skill-1"] });
  const order = await invoke("get_preset_skill_order", { presetId });
  assert.deepEqual(order.body.data, ["skill-1"]);

  const synced = await invoke("sync_skill_to_tool", { skillId: "skill-1", tool: "codex" });
  assert.equal(synced.body.ok, true, `同步失败：${synced.body.message}`);

  const deployedTarget = path.join("home", ".codex", "skills").replace(/\//g, path.sep);
  // 部署目标位于 home 下的工具目录；通过技能读回验证 target 记录。
  const skills = await invoke("get_managed_skills", {});
  const target = skills.body.data[0].targets.find(item => item.tool === "codex");
  assert.ok(target, "同步到工具后应产生 codex 部署记录");
  assert.ok(path.normalize(target.target_path).includes(path.normalize(deployedTarget)));

  // Preset 内的工具开关按 Preset 独立保存（非活动 Preset 只落库，不触发部署）。
  const toggled = await invoke("set_skill_tool_toggle", { presetId, skillId: "skill-1", tool: "codex", enabled: false });
  assert.equal(toggled.body.ok, true, `开关写入失败：${toggled.body.message}`);
  const toggles = await invoke("get_skill_tool_toggles", { presetId, skillId: "skill-1" });
  assert.equal(toggles.body.data.find(item => item.tool === "codex")?.enabled, false, "Preset 内的工具开关应落库");

  // 撤销同步后部署目标应被清空，不留陈旧副本。
  const unsynced = await invoke("unsync_skill_from_tool", { skillId: "skill-1", tool: "codex" });
  assert.equal(unsynced.body.ok, true, `撤销失败：${unsynced.body.message}`);
  const skillsAfter = await invoke("get_managed_skills", {});
  assert.equal(skillsAfter.body.data[0].targets.length, 0, "撤销同步后不应残留部署目标");

  // 非法路径参数返回结构化错误。
  const badOrder = await invoke("reorder_preset_skills", { presetId, skillIds: ["not-a-member"] });
  assert.equal(badOrder.body.ok, false);
});
