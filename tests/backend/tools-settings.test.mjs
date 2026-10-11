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

async function startServer(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manager-tools-test-"));
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
  return { invoke, home };
}

test("custom tool lifecycle: add, path overrides, enable, order, remove", async t => {
  const { invoke, home } = await startServer(t);

  const skillsDir = path.join(home, "my-tool", "skills");
  fs.mkdirSync(skillsDir, { recursive: true });

  const invalid = await invoke("add_custom_tool", { key: "Invalid Key!", displayName: "坏名字", skillsDir });
  assert.equal(invalid.body.ok, false);

  const added = await invoke("add_custom_tool", { key: "my_tool", displayName: "我的工具", skillsDir, projectRelativeSkillsDir: ".my/skills" });
  assert.equal(added.body.ok, true, `add 失败：${added.body.message}`);

  let tools = (await invoke("get_tool_status", {})).body.data;
  const custom = tools.find(tool => tool.key === "my_tool");
  assert.ok(custom, "自定义工具应出现在工具列表");
  assert.equal(custom.is_custom, true);
  assert.equal(custom.installed, true);
  assert.equal(custom.project_relative_skills_dir, ".my/skills");

  // 内置工具路径覆盖与重置
  const overrideDir = path.join(home, "codex-override", "skills");
  fs.mkdirSync(overrideDir, { recursive: true });
  assert.equal((await invoke("set_custom_tool_path", { key: "codex", path: overrideDir })).body.ok, true);
  tools = (await invoke("get_tool_status", {})).body.data;
  let codex = tools.find(tool => tool.key === "codex");
  assert.equal(codex.has_path_override, true);
  assert.ok(path.normalize(codex.skills_dir).includes(path.normalize(overrideDir)));
  assert.equal((await invoke("reset_custom_tool_path", { key: "codex" })).body.ok, true);
  codex = (await invoke("get_tool_status", {})).body.data.find(tool => tool.key === "codex");
  assert.equal(codex.has_path_override, false);

  // 项目相对目录覆盖与重置
  assert.equal((await invoke("set_custom_tool_project_path", { key: "codex", projectRelativeSkillsDir: ".codex/other-skills" })).body.ok, true);
  codex = (await invoke("get_tool_status", {})).body.data.find(tool => tool.key === "codex");
  assert.equal(codex.project_relative_skills_dir, ".codex/other-skills");
  assert.equal((await invoke("reset_custom_tool_project_path", { key: "codex" })).body.ok, true);

  // 启停
  assert.equal((await invoke("set_tool_enabled", { key: "codex", enabled: false })).body.ok, true);
  codex = (await invoke("get_tool_status", {})).body.data.find(tool => tool.key === "codex");
  assert.equal(codex.enabled, false);
  assert.equal((await invoke("set_all_tools_enabled", { enabled: true })).body.ok, true);
  tools = (await invoke("get_tool_status", {})).body.data;
  assert.ok(tools.every(tool => tool.enabled), "全部启用后不应有停用工具");

  // 排序：非法键被拒绝，合法排序生效
  assert.equal((await invoke("set_tool_order_cmd", { order: ["no_such_tool"] })).body.ok, false);
  const keys = (await invoke("get_tool_status", {})).body.data.map(tool => tool.key);
  const flipped = [...keys].reverse();
  assert.equal((await invoke("set_tool_order_cmd", { order: flipped })).body.ok, true);
  assert.deepEqual((await invoke("get_tool_status", {})).body.data.map(tool => tool.key), flipped);

  // 移除自定义工具
  assert.equal((await invoke("remove_custom_tool", { key: "my_tool" })).body.ok, true);
  tools = (await invoke("get_tool_status", {})).body.data;
  assert.equal(tools.some(tool => tool.key === "my_tool"), false);
  assert.equal((await invoke("remove_custom_tool", { key: "codex" })).body.ok, false, "内置工具不可移除");
});
