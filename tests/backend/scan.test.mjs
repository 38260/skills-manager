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

function writeSkill(directory, name, description) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n正文\n`);
}

async function startServer(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manager-scan-test-"));
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

test("scan discovers tool skills, groups by content, import flows update state", async t => {
  const { invoke, home } = await startServer(t);

  // 两个内容完全相同的技能分到一组；一个隐藏目录技能被跳过。
  const skillContent = "---\nname: alpha\ndescription: 阿尔法\n---\n正文\n";
  fs.mkdirSync(path.join(home, ".codex", "skills", "alpha"), { recursive: true });
  fs.writeFileSync(path.join(home, ".codex", "skills", "alpha", "SKILL.md"), skillContent);
  fs.mkdirSync(path.join(home, ".cursor", "skills", "alpha-copy"), { recursive: true });
  fs.writeFileSync(path.join(home, ".cursor", "skills", "alpha-copy", "SKILL.md"), skillContent);
  writeSkill(path.join(home, ".cursor", "skills", ".hidden", "beta"), "beta", "隐藏技能");
  writeSkill(path.join(home, ".codex", "skills", "gamma"), "gamma", "独立技能");

  const scan = await invoke("scan_local_skills", {});
  assert.equal(scan.body.ok, true, `scan 失败：${scan.body.message}`);
  assert.ok(scan.body.data.tools_scanned >= 2, "至少扫描 codex 与 cursor 两个工具");
  assert.equal(scan.body.data.skills_found, 3, "只应发现三个技能目录");
  const alphaGroup = scan.body.data.groups.find(group => group.name === "alpha");
  assert.ok(alphaGroup, "相同内容的副本应合入 alpha 分组");
  assert.equal(alphaGroup.locations.length, 2, "alpha 分组应包含两处位置");
  assert.equal(alphaGroup.imported, false);

  // 认领单个技能
  const imported = await invoke("import_existing_skill", { sourcePath: alphaGroup.locations[0].found_path, name: null });
  assert.equal(imported.body.ok, true, `import 失败：${imported.body.message}`);
  let skills = (await invoke("get_managed_skills", {})).body.data;
  assert.equal(skills.some(skill => skill.name === "alpha"), true);

  // 再次扫描：来源副本仍会发现（与旧版一致），同内容多副本同组并通过指纹标记已导入
  const secondScan = await invoke("scan_local_skills", {});
  assert.equal(secondScan.body.ok, true);
  const updatedGroup = secondScan.body.data.groups.find(group => group.name === "alpha");
  assert.equal(updatedGroup.imported, true, "alpha 分组应通过指纹标记为已导入");
  assert.equal(updatedGroup.locations.length, 2, "两个内容相同的副本仍在同一分组");

  // 全部导入：跳过已导入分组，仅 gamma 入库
  const importAll = await invoke("import_all_discovered", {});
  assert.equal(importAll.body.ok, true, `import_all 失败：${importAll.body.message}`);
  const allSkills = (await invoke("get_managed_skills", {})).body.data;
  assert.equal(allSkills.length, 2, "alpha 与 gamma 均已入库");

  // 非法路径导入返回结构化错误
  const bad = await invoke("import_existing_skill", { sourcePath: path.join(home, "not-a-skill") });
  assert.equal(bad.body.ok, false);
});

test("slugify keeps index alignment with input", async t => {
  const { invoke } = await startServer(t);
  const names = ["Hello World", "代码 Review!", "...", "a_b.c", ""];
  const result = await invoke("slugify_skill_names", { names });
  assert.equal(result.body.ok, true);
  assert.equal(result.body.data.length, names.length, "输出必须与输入等长");
  assert.deepEqual(result.body.data, ["hello-world", "review", "skill", "a_b.c", "skill"]);
});
