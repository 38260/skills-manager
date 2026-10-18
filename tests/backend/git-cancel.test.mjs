import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, message) {
  const deadline = Date.now() + 5000;
  while (!await check()) {
    if (Date.now() >= deadline) throw new Error(message);
    await delay(25);
  }
}

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manager-cancel-"));
  const directory = path.join(root, "app"), home = path.join(root, "home");
  const store = new Store({ directory, home });
  const source = path.join(root, "source");
  fs.mkdirSync(source);
  const original = "---\nname: cancellation-fixture\n---\nOriginal content\n";
  fs.writeFileSync(path.join(source, "SKILL.md"), original);
  const skill = await new Library(store).installLocal(source);
  store.run("UPDATE skills SET source_type='git',source_ref=? WHERE id=?", "https://cancel.invalid/update.git", skill.id);
  store.close();

  let requests = 0;
  const sockets = new Set();
  // 真实 Git 连接本地 HTTP 后一直等响应；测试通过前不能替它断开连接。
  const remote = http.createServer(() => { requests++; });
  remote.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  remote.listen(0, "127.0.0.1");
  await once(remote, "listening");
  const remotePort = remote.address().port;
  const probe = http.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ["backend/server.mjs", "--port", String(port), "--directory", directory, "--home", home], {
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.http://127.0.0.1:${remotePort}/.insteadOf`, GIT_CONFIG_VALUE_0: "https://cancel.invalid/" },
  });
  let stderr = "";
  child.stdout.on("data", () => {});
  child.stderr.on("data", chunk => { stderr += chunk; });
  t.after(async () => {
    remote.closeAllConnections();
    await new Promise(resolve => remote.close(resolve));
    if (child.exitCode === null) { const exit = once(child, "exit"); child.kill(); await exit; }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => { try { return (await fetch(base + "/api/health")).ok; } catch { return false; } }, "服务启动失败：" + stderr);
  const invoke = async (command, args = {}) => (await fetch(base + "/api/invoke/" + command, {
    method: "POST", headers: { "content-type": "application/json", "x-skills-manager-client": "webview" }, body: JSON.stringify(args),
  })).json();
  return { invoke, directory, skill, original, requests: () => requests, sockets };
}

for (const command of ["preview_git_install", "update_skill"]) {
  test(`${command} 真实传输卡住时取消进程树并清理缓存`, { timeout: 15000 }, async t => {
    const { invoke, directory, skill, original, requests, sockets } = await fixture(t);
    const key = command === "update_skill" ? `update:${skill.id}` : "https://cancel.invalid/preview.git";
    let result;
    const pending = invoke(command, command === "update_skill" ? { skillId: skill.id } : { repoUrl: key }).then(value => { result = value; });
    await waitFor(() => requests() > 0, "Git 没有到达测试 HTTP 服务");
    const cancelled = await invoke("cancel_install", { key });
    assert.equal(cancelled.ok, true, JSON.stringify(cancelled));
    assert.equal(cancelled.data, true);
    await waitFor(() => result !== undefined, "取消后仍等待远端响应");
    await pending;
    assert.equal(result.ok, false);
    assert.equal(result.code, "CANCELLED");
    assert.equal(result.kind, "cancelled");
    await waitFor(() => sockets.size === 0, "Git 子进程仍持有传输连接");
    assert.deepEqual(fs.readdirSync(path.join(directory, "cache")), []);
    assert.equal(fs.readFileSync(path.join(skill.central_path, "SKILL.md"), "utf8"), original);
    assert.equal((await invoke("cancel_install", { key })).data, false);
    assert.equal((await invoke("get_managed_skills")).data.length, 1);
  });
}
