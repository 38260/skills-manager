import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";

test("真实 HTTP 接口保存译文、重启持久化、拒绝冲突且原文件不变", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manager-translation-http-"));
  const directory = path.join(root, "app"), source = path.join(root, "source");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "SKILL.md"), "---\nname: http-example\n---\n## English\nOriginal content\n");
  const store = new Store({ directory, home: root });
  const skill = await new Library(store).installLocal(source);
  const original = fs.readFileSync(path.join(skill.central_path, "SKILL.md"));
  store.close();
  let child;
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise(resolve => child.once("exit", resolve));
    child.kill(); await exited;
  }
  t.after(async () => { await stop(); fs.rmSync(root, { recursive: true }); });
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  async function start() {
    let stderr = "";
    child = spawn(process.execPath, ["backend/server.mjs", "--port", String(port), "--directory", directory, "--home", root], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    child.stderr.on("data", chunk => { stderr += chunk; });
    for (const deadline = Date.now() + 10000; ;) {
      try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
      if (Date.now() > deadline || child.exitCode !== null) throw new Error(`Server did not start: ${stderr}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  const invoke = async (command, args) => (await fetch(`${base}/api/invoke/${command}`, { method: "POST", headers: { "content-type": "application/json", "x-skills-manager-client": "webview" }, body: JSON.stringify(args) })).json();
  await start();
  assert.equal((await fetch(`${base}/api/invoke/get_skill_translation`, { method: "POST", body: "{}" })).status, 403);
  const first = await invoke("get_skill_translation", { skillId: skill.id });
  assert.equal(first.ok, true);
  assert.equal(first.data.content, null);
  const args = { skillId: skill.id, content: "## 中文目录\n中文正文", sourceHash: first.data.source_hash, expectedRevision: null };
  const saved = await invoke("set_skill_translation", args);
  assert.equal(saved.ok, true);
  assert.equal((await invoke("set_skill_translation", args)).ok, false);
  await stop(); await start();
  const restored = await invoke("get_skill_translation", { skillId: skill.id });
  assert.equal(restored.data.content, args.content);
  assert.equal(restored.data.revision, saved.data.revision);
  assert.deepEqual(fs.readFileSync(path.join(skill.central_path, "SKILL.md")), original);
});
