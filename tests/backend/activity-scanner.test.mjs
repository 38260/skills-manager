import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zstdCompressSync } from "node:zlib";
import { UsageStore, defaultSources } from "../../backend/activity/store.mjs";
import { scanSources, PARSER_VERSION } from "../../backend/activity/scanner.mjs";
import { ActivityService, matchManagedSkill } from "../../backend/activity/service.mjs";

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "activity-scan-"));
  const store = new UsageStore(path.join(directory, "usage"));
  store.initialize(defaultSources(directory, {}));
  for (const source of store.sources()) store.configure(source.tool, source.path, false);
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { directory, store };
}
const line = value => JSON.stringify(value) + "\n";
const call = id => ({ type: "function_call", sessionId: "s", timestamp: 1000, callId: id, name: "Skill", arguments: '{"skill":"design"}' });

test("扫描去重、变化文件刷新、半行恢复、重写与目录联接，来源丢失保留历史", async t => {
  const { directory, store } = fixture(t), logs = path.join(directory, "logs"), linked = path.join(directory, "linked");
  fs.mkdirSync(logs); fs.symlinkSync(logs, linked, "junction");
  fs.symlinkSync(logs, path.join(logs, "cycle"), "junction");
  const file = path.join(logs, "a.jsonl");
  store.configure("workbuddy", linked, true);
  fs.writeFileSync(file, line(call("c1")) + '{"type":');
  let result = await scanSources(store);
  assert.equal(result.parsed, 1); assert.equal(store.query().total, 1);
  assert.equal(store.sources().find(s => s.tool === "workbuddy").state, "partial");
  result = await scanSources(store); assert.equal(result.parsed, 0); assert.ok(result.errors > 0);
  fs.writeFileSync(file, line(call("c1")) + line({ type: "function_call_result", callId: "c1", status: "completed" }));
  fs.copyFileSync(file, path.join(logs, "copy.jsonl"));
  await scanSources(store); assert.equal(store.query().total, 1); assert.equal(store.query().items[0].status, "returned");
  fs.writeFileSync(file, line(call("c2"))); await scanSources(store); assert.equal(store.query().total, 2);
  store.configure("workbuddy", path.join(directory, "missing"), true);
  await scanSources(store); assert.equal(store.sources().find(s => s.tool === "workbuddy").state, "missing");
  assert.equal(store.query().total, 2);
});

test("Codex 会话和归档合并，不把失败读取计为加载，取消后可恢复", async t => {
  const { directory, store } = fixture(t), root = path.join(directory, ".codex"), logs = path.join(root, "sessions");
  fs.mkdirSync(logs, { recursive: true });fs.mkdirSync(path.join(root, "archived_sessions"));
  const data = line({ type: "session_meta", payload: { id: "s", cwd: "/demo" } }) +
    line({ type: "response_item", payload: { type: "function_call", call_id: "c", name: "exec_command", arguments: '{"cmd":"cat /skills/ui/SKILL.md"}' } }) +
    line({ type: "response_item", payload: { type: "function_call_output", call_id: "c", output: "Process exited with code 1" } });
  fs.writeFileSync(path.join(logs, "a.jsonl"), data);fs.writeFileSync(path.join(root, "archived_sessions", "copy.jsonl"), data);
  store.configure("codex", logs, true);
  assert.equal((await scanSources(store, { cancelled: () => true })).cancelled, true);
  const result = await scanSources(store);assert.equal(result.files, 2);assert.equal(store.query().total, 1);
  assert.equal(store.query().counts.document, 0);assert.equal(store.query().items[0].status, "failed");
});

test("后台采集串行，接口查询分页；通知独立于技能同步", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "activity-service-")), logs = path.join(directory, ".workbuddy", "projects");
  fs.mkdirSync(logs, { recursive: true });fs.writeFileSync(path.join(logs, "a.jsonl"), line(call("c1")));
  const notices = [], service = new ActivityService({ directory: path.join(directory, "usage"), home: directory, env: {}, interval: 0, emit: name => notices.push(name) });
  t.after(async () => { await service.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  service.scan();const worker = service.worker;service.scan();assert.equal(service.worker, worker);
  await new Promise((resolve, reject) => { worker.once("exit", resolve); worker.once("error", reject); });
  const result = service.commands.get_skill_activity.call({ tool: "workbuddy", pageSize: 10 });
  assert.equal(result.total, 1);assert.equal(result.items[0].managedSkillId, null);
  assert.ok(notices.length);assert.ok(notices.every(name => name === "skill-activity-changed"));
  assert.equal(service.commands.get_skill_activity_sources.call().running, false);
});

test("DSH 选择同会话最新代，旧版文件不重复统计或产生伪错误", async t => {
  const { directory, store } = fixture(t), logs = path.join(directory, "dsh");fs.mkdirSync(logs);
  fs.writeFileSync(path.join(logs, "s.jsonl.zstd"), zstdCompressSync(Buffer.from(line({ type: "session", version: 0, id: "s" }))));
  fs.writeFileSync(path.join(logs, "s.v4.jsonl.zstd"), zstdCompressSync(Buffer.from(line({ type: "session", version: 4, id: "s" }) + line({ type: "tool/call", time: 1000, data: { name: "skill", callId: "c", arguments: '{"name":"ui"}' } }))));
  store.configure("dsh", logs, true);const result = await scanSources(store);
  assert.equal(result.files, 1);assert.equal(result.errors, 0);assert.equal(store.query().total, 1);
});

test("扫描中取消不保存完成指纹，重开历史库后可恢复且不重复", async t => {
  const { directory, store } = fixture(t), logs = path.join(directory, "resume");fs.mkdirSync(logs);
  fs.writeFileSync(path.join(logs, "a.jsonl"), line(call("a")) + line(call("b")));
  store.configure("workbuddy", logs, true);
  const first = await scanSources(store, { cancelled: () => store.query().total > 0 });
  assert.equal(first.cancelled, true);assert.equal(store.query().total, 1);
  const reopened = new UsageStore(path.join(directory, "usage"));
  try { await scanSources(reopened);assert.equal(reopened.query().total, 2); }
  finally { reopened.close(); }
});

test("同名技能歧义保留未关联，明确路径不退回名称猜测", () => {
  const skills = ["a", "b"].map(id => ({ id, name: "ui", central_path: `/central/${id}`, targets: [{ tool: "codex", target_path: `/project/${id}` }] }));
  assert.equal(matchManagedSkill({ tool: "codex", skillName: "ui", project: "/project" }, skills), null);
  assert.equal(matchManagedSkill({ tool: "codex", skillName: "ui", skillPath: "/project/a/SKILL.md" }, skills), "a");
  assert.equal(matchManagedSkill({ tool: "codex", skillName: "ui", skillPath: "/other/SKILL.md" }, skills), null);
});

test("解析器升级后旧缓存的错误计数失效并重新读取，来源恢复为就绪", async t => {
  const { directory, store } = fixture(t), logs = path.join(directory, "logs"); fs.mkdirSync(logs);
  const file = path.join(logs, "a.jsonl");
  fs.writeFileSync(file, line(call("c1")));
  store.configure("workbuddy", logs, true);
  await scanSources(store);
  assert.equal(store.sources().find(s => s.tool === "workbuddy").state, "ready");

  // 模拟旧版本解析器留下的错误计数（写入时版本比当前低）。
  store.db.prepare("UPDATE scanned_files SET errors=3, parser_version=? WHERE tool='workbuddy'").run(PARSER_VERSION - 1);
  const stale = await scanSources(store);
  assert.equal(stale.parsed, 1, "解析器版本不一致时必须重新读取文件");
  assert.equal(store.sources().find(s => s.tool === "workbuddy").state, "ready", "重新读取后不应残留旧的错误计数");

  // 版本一致且文件未变化时仍走缓存（不重复读取，但保留当次真实错误数）。
  const again = await scanSources(store);
  assert.equal(again.parsed, 0);
  assert.equal(again.errors, 0);
});
