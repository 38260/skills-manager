import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UsageStore, defaultSources } from "../../backend/activity/store.mjs";
import { scanSources, PARSER_VERSION } from "../../backend/activity/scanner.mjs";
import { repairGenericRequests } from "../../backend/activity/request-repair.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "activity-request-repair-"));
  const store = new UsageStore(path.join(root, "usage"));
  store.initialize(defaultSources(root, {}));
  for (const source of store.sources()) store.configure(source.tool, source.path, false);
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, store };
}
const message = content => ({ type: "response_item", payload: { type: "message", role: "user", content } });
function seed(store, sourcePath, id, overrides = {}) {
  const event = { id, tool: "codex", skillName: "this", skillPath: null, timestamp: 1000,
    sessionId: "s", project: "/demo", callId: "request:u", kind: "request", trigger: "manual",
    status: "pending", evidence: "user_selection", sourcePath, sourceLine: "1", ...overrides };
  store.put(event);
  return event;
}
function log(root, name, content) {
  const filename = path.join(root, `${name}.jsonl`);
  fs.writeFileSync(filename, JSON.stringify(message(content)) + "\n");
  return filename;
}

test("历史泛指请求可恢复隔离，来源丢失单独标记，调用加载和真实点名完整保留", async t => {
  const { root, store } = fixture(t);
  const prose = log(root, "prose", "Use this skill to automate the UI.");
  const bad = seed(store, prose, "bad");
  seed(store, path.join(root, "missing.jsonl"), "missing");
  seed(store, prose, "loaded", { kind: "document", status: "returned" });
  seed(store, prose, "invoked", { kind: "invocation", status: "returned" });
  seed(store, prose, "path", { skillPath: "/skills/this/SKILL.md" });
  seed(store, prose, "failed", { status: "failed" });
  seed(store, prose, "other", { skillName: "pdf" });
  seed(store, prose, "tool", { tool: "workbuddy" });
  for (const [id, text] of [["dollar", "$this"], ["slash", "/skill this"], ["mention", "@skill:this"]]) {
    seed(store, log(root, id, text), id);
  }
  seed(store, log(root, "structured", [{ type: "skill", name: "this" }]), "structured");
  const survivors = store.query().items.filter(row => !["bad", "missing"].includes(row.id));
  assert.deepEqual(await repairGenericRequests(store), { archived: 2, confirmed: 1, missing: 1 });
  assert.deepEqual(store.query().items, survivors);
  const archived = store.db.prepare("SELECT * FROM archived_requests WHERE id='bad'").get();
  for (const [key, value] of Object.entries(bad)) assert.equal(archived[key], value, key);
  assert.equal(archived.reason, "generic_skill_reference");
  assert.equal(store.db.prepare("SELECT reason FROM archived_requests WHERE id='missing'").get().reason, "unverifiable_missing_source");
  assert.deepEqual(await repairGenericRequests(store), { archived: 0, confirmed: 0, missing: 0 });
});

test("取消、无关原文和无效行号不清除历史", async t => {
  const { root, store } = fixture(t);
  seed(store, log(root, "plain", "处理文档"), "plain");
  seed(store, log(root, "invalid-line", "Use this skill for editing."), "invalid-line", { sourceLine: "20" });
  seed(store, log(root, "prose", "Use this skill for editing."), "prose");
  const before = store.query().items;
  await repairGenericRequests(store, { cancelled: () => true });
  assert.deepEqual(store.query().items, before);
  await repairGenericRequests(store);
  assert.deepEqual(store.query().items.map(row => row.id).sort(), ["invalid-line", "plain"]);
});

test("升级扫描先隔离历史误报，旧缓存重读且不重新产生 this，真实请求保留", async t => {
  const { root, store } = fixture(t);
  const logs = path.join(root, "logs"); fs.mkdirSync(logs);
  const prose = log(logs, "prose", "Use this skill to automate apps.");
  log(logs, "real", "$pdf");
  store.configure("codex", logs, true);
  await scanSources(store);
  seed(store, prose, "legacy");
  store.db.exec("DELETE FROM activity_repairs");
  store.db.prepare("UPDATE scanned_files SET parser_version=?").run(PARSER_VERSION - 1);
  const result = await scanSources(store);
  assert.equal(result.parsed, 2);
  assert.equal(result.errors, 0);
  assert.deepEqual(store.query().items.map(row => row.skillName), ["pdf"]);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM archived_requests").get().n, 1);
  assert.equal((await scanSources(store)).parsed, 0);
  assert.equal(store.query().total, 1);
});

test("隔离事务失败时恢复原事件和归档，缺失日志恢复后可重新识别真实 this", async t => {
  const { root, store } = fixture(t);
  seed(store, log(root, "prose", "Use this skill for editing."), "prose");
  store.db.exec("CREATE TRIGGER stop_repair BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'test rollback'); END");
  await assert.rejects(repairGenericRequests(store), /test rollback/);
  assert.equal(store.query().total, 1);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM archived_requests").get().n, 0);
  store.db.exec("DROP TRIGGER stop_repair");
  const logs = path.join(root, "restored"); fs.mkdirSync(logs);
  const missing = path.join(logs, "real.jsonl");
  seed(store, missing, "missing");
  await repairGenericRequests(store);
  fs.writeFileSync(missing, JSON.stringify(message("$this")) + "\n");
  store.configure("codex", logs, true);
  await scanSources(store);
  assert.deepEqual(store.query().items.map(row => row.skillName), ["this"]);
  assert.equal((await repairGenericRequests(store)).archived, 0);
  fs.unlinkSync(missing);
  assert.equal((await repairGenericRequests(store)).archived, 0, "迁移后真实请求的日志丢失也不能再次隔离");
  assert.deepEqual(store.query().items.map(row => row.skillName), ["this"]);
});
