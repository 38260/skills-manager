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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manager-repopath-test-"));
  const home = path.join(directory, "home");
  fs.mkdirSync(home, { recursive: true });
  const port = await freePort();
  const child = spawn(process.execPath, [serverModule, "--port", String(port), "--directory", path.join(directory, "repo"), "--home", home],
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
  return { invoke, directory };
}

test("repo path settings: override, pending promotion on restart, warnings, device name", async t => {
  const { invoke, directory } = await startServer(t);

  // 目录参数启动时 override 为空
  assert.equal((await invoke("get_central_repo_path_override", {})).body.data, null);
  assert.equal((await invoke("get_central_repo_pending_path", {})).body.data, null);
  assert.deepEqual((await invoke("get_central_repo_warnings", {})).body.data, []);

  // 保存新路径 → 返回待生效路径并写入 pending
  const nextRepo = path.join(directory, "next-repo");
  const saved = await invoke("set_central_repo_path", { path: nextRepo });
  assert.equal(saved.body.ok, true, `保存失败：${saved.body.message}`);
  assert.equal((await invoke("get_central_repo_pending_path", {})).body.data, path.resolve(nextRepo));

  // 相同路径与盘根被拒绝
  assert.equal((await invoke("set_central_repo_path", { path: path.join(directory, "repo") })).body.ok, false);
  assert.equal((await invoke("set_central_repo_path", { path: path.parse(directory).root })).body.ok, false);

  // 重置 → pending 清空
  assert.equal((await invoke("set_central_repo_path", { path: null })).body.ok, true);
  assert.equal((await invoke("get_central_repo_pending_path", {})).body.data, null);
  await invoke("set_central_repo_path", { path: nextRepo });

  // 无 pending 时的警告保持为空
  assert.deepEqual((await invoke("get_central_repo_warnings", {})).body.data, []);

  // 设备名：清洗并返回
  const device = await invoke("backup_set_device_name", { name: "  我的<设备>名  " });
  assert.equal(device.body.ok, true);
  assert.equal(device.body.data, "我的 设备 名");
  assert.equal((await invoke("backup_device_name", {})).body.data, "我的 设备 名");
});

test("pending repo path is promoted on restart without --directory", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manager-promote-test-"));
  t.after(() => { try { fs.rmSync(directory, { recursive: true, force: true }); } catch {} });
  const home = path.join(directory, "home");
  const defaultRepo = path.join(home, ".skills-manager");
  const nextRepo = path.join(directory, "moved-repo");
  fs.mkdirSync(path.join(defaultRepo, "skills"), { recursive: true });
  fs.writeFileSync(path.join(defaultRepo, "repo-config.json"), JSON.stringify({ pending_repo_path: nextRepo }));

  // 默认目录启动：pending 晋升为 repo_path，pending 清空，无警告
  const store = new Store({ home });
  assert.equal(store.directory, path.resolve(nextRepo));
  assert.equal(store.repoPathOverride, path.resolve(nextRepo));
  assert.equal(store.pendingRepoPath, null);
  assert.deepEqual(store.startupWarnings, []);
  const config = JSON.parse(fs.readFileSync(path.join(defaultRepo, "repo-config.json"), "utf8"));
  assert.equal(config.repo_path, path.resolve(nextRepo));
  assert.equal(config.pending_repo_path, undefined);
  store.close();

  // 无效 pending：回退默认并产生警告
  fs.writeFileSync(path.join(defaultRepo, "repo-config.json"), JSON.stringify({ repo_path: path.resolve(nextRepo), pending_repo_path: path.parse(directory).root }));
  const fallback = new Store({ home });
  assert.equal(fallback.directory, path.resolve(nextRepo), "晋升失败应保留原路径");
  assert.equal(fallback.startupWarnings.length, 1, "应产生启动警告");
  assert.match(fallback.startupWarnings[0], /无法使用/);
  fallback.close();
});
