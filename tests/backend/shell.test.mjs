import { test } from "node:test";
import assert from "node:assert/strict";
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

async function startServer(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manager-shell-test-"));
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

test("desktop shell commands: diagnostics, log excerpt, panic, update blocker", async t => {
  const { invoke, directory } = await startServer(t);

  const info = (await invoke("get_diagnostic_info", {})).body.data;
  assert.equal(info.os, "Windows");
  assert.equal(info.arch, process.arch);
  assert.equal(info.central_repo_path_overridden, false);
  assert.match(info.app_version, /^\d+\.\d+\.\d+$/);

  // 日志摘录：服务启动日志应已落盘
  const excerpt = (await invoke("get_recent_log_excerpt", {})).body.data;
  assert.ok(excerpt.line_count >= 1, "启动日志应至少一行");
  assert.ok(excerpt.log_path.includes("server.log"));

  // panic：预置文件后可读、可清除
  const panicPath = path.join(directory, "repo", "logs", "panic.json");
  fs.mkdirSync(path.dirname(panicPath), { recursive: true });
  fs.writeFileSync(panicPath, JSON.stringify({ timestamp: "2026-10-11T00:00:00.000Z", message: "boom" }));
  let panic = (await invoke("check_last_panic", {})).body.data;
  assert.equal(panic.message, "boom");
  assert.equal((await invoke("clear_last_panic", {})).body.ok, true);
  panic = (await invoke("check_last_panic", {})).body.data;
  assert.equal(panic, null);

  // 更新检查：无 manifest 时报告当前版本无更新；更新阻断器无阻塞
  const update = (await invoke("check_app_update", {})).body.data;
  assert.equal(update.has_update, false);
  assert.match(update.current_version, /^\d+\.\d+\.\d+$/);
  assert.equal((await invoke("update_install_blocker", {})).body.data, null);

  // 日志导出为 zip
  const exported = (await invoke("export_logs_zip", {})).body.data;
  assert.ok(exported.file_count >= 1);
  assert.ok(fs.existsSync(exported.zip_path));
  assert.equal(fs.statSync(exported.zip_path).size > 0, true);
});
