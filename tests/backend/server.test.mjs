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

function seedSkillStore(directory, { skillId = "skill-1", skillName = "example" } = {}) {
  const store = new Store({ directory, home: directory });
  const skillDirectory = path.join(directory, "skills", skillName);
  fs.mkdirSync(skillDirectory, { recursive: true });
  fs.writeFileSync(path.join(skillDirectory, "SKILL.md"), `---\nname: ${skillName}\ndescription: 测试技能\nmetadata:\n  author: Alice\n---\n# ${skillName}\n正文\n`);
  const now = Date.now();
  store.run("INSERT INTO skills(id,name,description,source_type,central_path,content_hash,enabled,created_at,updated_at,status,update_status) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    skillId, skillName, "测试技能", "import", skillDirectory, "seed-hash", true, now, now, "ok", "local_only");
  store.run("INSERT INTO skill_tags(skill_id,tag) VALUES(?,?)", skillId, "UI");
  return store;
}

async function startServer(t, { seed = () => {}, directory: provided } = {}) {
  const directory = provided ?? fs.mkdtempSync(path.join(os.tmpdir(), "skills-manager-server-test-"));
  seed(directory);
  const port = await freePort();
  const child = spawn(process.execPath, [serverModule, "--port", String(port), "--directory", directory, "--home", directory],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  const invoke = async (command, args, headers) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/invoke/${command}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-skills-manager-client": "webview", ...headers },
      body: JSON.stringify(args ?? {}),
    });
    return { status: response.status, body: await response.json() };
  };
  const deadline = Date.now() + 10000;
  for (;;) {
    try {
      const health = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (health.ok) break;
    } catch {}
    if (Date.now() > deadline || child.exitCode !== null) {
      child.kill();
      throw new Error(`本地服务未在期限内就绪。stderr：${stderr}`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  // Windows 上 kill 是异步的：等待子进程真正退出后再清理目录，否则 SQLite 文件仍被锁定
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once("exit", resolve));
      child.kill();
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
    }
    if (!provided) {
      try { fs.rmSync(directory, { recursive: true, force: true }); }
      catch (error) { console.warn(`测试目录清理失败（可手动删除）：${directory}，原因：${error.message}`); }
    }
  });
  return { port, directory, invoke, stderr: () => stderr };
}

async function openEvents(port) {
  const response = await fetch(`http://127.0.0.1:${port}/api/events`, { headers: { accept: "text/event-stream" } });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    async next(timeout = 5000) {
      const deadline = Date.now() + timeout;
      for (;;) {
        const match = /event: ([a-z-]+)\ndata: (.*)\n\n/.exec(buffer);
        if (match) { buffer = buffer.slice(match.index + match[0].length); return { name: match[1], data: JSON.parse(match[2]) }; }
        if (Date.now() > deadline) throw new Error(`等待 SSE 事件超时，最近收到：${buffer.slice(-300)}`);
        const result = await Promise.race([reader.read(), new Promise(resolve => setTimeout(() => resolve({}), Math.max(50, deadline - Date.now())))]);
        if (result.done) throw new Error("SSE 连接提前关闭");
        if (result.value) buffer += decoder.decode(result.value, { stream: true });
      }
    },
    close() { reader.cancel().catch(() => {}); },
  };
}

test("技能与作者通过服务读取，工具状态携带项目路径覆盖字段", async t => {
  const service = await startServer(t, { seed: directory => { seedSkillStore(directory).close(); } });
  const { body } = await service.invoke("get_managed_skills");
  assert.equal(body.ok, true);
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].author, "Alice");
  assert.equal(body.data[0].author_source, "metadata.author");
  assert.deepEqual(body.data[0].tags, ["UI"]);
  assert.equal(body.data[0].description, "测试技能");
  const tools = await service.invoke("get_tool_status");
  assert.equal(tools.body.ok, true);
  assert.ok(tools.body.data.length > 0);
  for (const tool of tools.body.data) assert.equal(typeof tool.has_project_path_override, "boolean");
  const repoPath = await service.invoke("get_central_repo_path");
  assert.equal(repoPath.body.data, service.directory);
});

test("分类增改删通过服务生效，改名保留归类关系，变更触发事件通知", async t => {
  const service = await startServer(t, { seed: directory => { seedSkillStore(directory).close(); } });
  const events = await openEvents(service.port);
  t.after(() => events.close());

  await service.invoke("create_skill_category", { name: "Docs" });
  await events.next();
  let categories = (await service.invoke("get_skill_categories")).body.data;
  assert.ok(categories.includes("Docs"));

  await service.invoke("set_skill_tags", { skillId: "skill-1", tags: ["Docs", "UI"] });
  await events.next();
  let skills = (await service.invoke("get_managed_skills")).body.data;
  assert.deepEqual(skills[0].tags.sort(), ["Docs", "UI"]);

  await service.invoke("rename_tag", { oldName: "Docs", newName: "文档" });
  await events.next();
  categories = (await service.invoke("get_skill_categories")).body.data;
  assert.ok(categories.includes("文档"));
  assert.ok(!categories.includes("Docs"));
  skills = (await service.invoke("get_managed_skills")).body.data;
  assert.deepEqual(skills[0].tags.sort(), ["UI", "文档"], "改名后归类关系应保留到新名称");

  await service.invoke("delete_tag", { name: "文档" });
  await events.next();
  categories = (await service.invoke("get_skill_categories")).body.data;
  assert.ok(!categories.includes("文档"));
  skills = (await service.invoke("get_managed_skills")).body.data;
  assert.deepEqual(skills[0].tags, ["UI"], "删除分类只移除归类关系");
  assert.equal(skills.length, 1, "删除分类不删除技能");
  assert.ok(fs.existsSync(skills[0].central_path), "技能文件保留");
});

test("错误反馈结构化：参数错误、未接入命令与请求守卫", async t => {
  const service = await startServer(t, { seed: directory => { seedSkillStore(directory).close(); } });
  const invalid = await service.invoke("create_skill_category", { name: " " });
  assert.equal(invalid.body.ok, false);
  assert.ok(invalid.body.message.includes("分类名称不能为空"));

  const notImplemented = await service.invoke("get_projects");
  assert.equal(notImplemented.body.ok, false);
  assert.equal(notImplemented.body.code, "NOT_IMPLEMENTED");

  const unknown = await service.invoke("definitely_not_a_command");
  assert.equal(unknown.body.ok, false);
  assert.equal(unknown.body.code, "NOT_IMPLEMENTED");

  const missing = await service.invoke("get_managed_skills", {}, { "x-skills-manager-client": "" });
  assert.equal(missing.status, 403);

  const crossOrigin = await service.invoke("get_managed_skills", {}, { origin: "http://evil.example" });
  assert.equal(crossOrigin.status, 403);

  const raw = await fetch(`http://127.0.0.1:${service.port}/api/invoke/get_managed_skills`, {
    method: "POST", headers: { "content-type": "application/json", "x-skills-manager-client": "webview" }, body: "{not json",
  });
  assert.equal(raw.status, 400);
});

test("设置读写、活动预设持久，服务重启后从既有存储恢复", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manager-server-restart-test-"));
  t.after(async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      try { fs.rmSync(directory, { recursive: true, force: true }); return; }
      catch { await new Promise(resolve => setTimeout(resolve, 300)); }
    }
  });
  let presetId;
  const first = await startServer(t, { directory, seed: () => {
    const store = seedSkillStore(directory);
    store.setSetting("text_size", "large");
    presetId = store.presets()[0].id;
    store.run("INSERT INTO active_scenario(key,scenario_id) VALUES('current',?)", presetId);
    store.close();
  } });
  const size = await first.invoke("get_settings", { key: "text_size" });
  assert.equal(size.body.data, "large");
  const active = await first.invoke("get_active_preset");
  assert.equal(active.body.data?.id, presetId);
  const presets = await first.invoke("get_presets");
  assert.ok(presets.body.data.some(preset => preset.id === presetId));

  // 同一目录重启服务：设置、技能与活动预设均从既有存储恢复
  const second = await startServer(t, { directory });
  const reopenedSize = await second.invoke("get_settings", { key: "text_size" });
  assert.equal(reopenedSize.body.data, "large");
  const reopenedSkills = await second.invoke("get_managed_skills");
  assert.equal(reopenedSkills.body.data.length, 1);
  const reopenedActive = await second.invoke("get_active_preset");
  assert.equal(reopenedActive.body.data?.id, presetId);
});

test("已构建前端通过服务直接访问（SPA 回退与未知接口）", async t => {
  const service = await startServer(t, { seed: directory => { seedSkillStore(directory).close(); } });
  const index = await fetch(`http://127.0.0.1:${service.port}/`);
  if (index.status === 503) return; // dist 未构建时跳过该验证
  assert.equal(index.status, 200);
  assert.match(index.headers.get("content-type"), /text\/html/);
  const html = await index.text();
  assert.match(html, /<div id="root">/);
  const route = await fetch(`http://127.0.0.1:${service.port}/my-skills`);
  assert.equal(route.status, 200);
  const missing = await fetch(`http://127.0.0.1:${service.port}/api/nothing`);
  assert.equal(missing.status, 404);
});
