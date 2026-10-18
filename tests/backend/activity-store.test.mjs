import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UsageStore, defaultSources, eventId } from "../../backend/activity/store.mjs";

test("历史幂等更新、筛选分页、请求不计入实际触发数，且不保存原始内容", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "activity-store-"));
  const store = new UsageStore(directory);
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const event = { id: eventId("codex", "call1", "ui"), tool: "codex", skillName: "ui", timestamp: 1000,
    sessionId: "s1", project: "/demo", callId: "call1", kind: "document", trigger: "unknown", status: "pending",
    evidence: "document_read", sourcePath: "/logs/s.jsonl", sourceLine: "2", rawContent: "private message" };
  store.put(event); store.put({ ...event, status: "returned", trigger: "manual" }); store.put(event);
  assert.equal(store.query().total, 1);
  assert.equal(store.query().items[0].status, "returned");
  assert.equal(store.query().items[0].trigger, "manual");
  store.put({ ...event, id: "request", kind: "request", trigger: "manual" });
  store.put({ ...event, id: "other", skillName: "ui_2", tool: "qoder", timestamp: 2000 });
  assert.equal(store.query({ pageSize: 1, page: 2 }).items.length, 1);
  assert.equal(store.query({ skillName: "_" }).total, 1);
  assert.equal(store.query({ from: 1500, to: 2500 }).total, 1);
  assert.equal(store.query().counts.manual, 1);
  assert.equal(store.query().counts.request, 1);
  assert.ok(!JSON.stringify(store.query()).includes("private message"));
  assert.throws(() => store.query({ tool: "codex' OR 1=1" }));
  store.initialize(defaultSources(directory, {}));
  store.configure("codex", path.join(directory, "logs"), false);
  const reader = new UsageStore(directory);
  assert.equal(reader.query().total, 3);
  assert.equal(reader.sources()[0].enabled, false);
  reader.close();
});

test("切换类型/触发方式筛选时统计数字不变，只收窄列表", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "activity-facet-"));
  const store = new UsageStore(directory);
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const base = { tool: "codex", skillName: "ui", timestamp: 1000, sessionId: "s", project: "/demo", callId: "c",
    status: "returned", evidence: "skill_call", sourcePath: "/logs/s.jsonl", sourceLine: "2" };
  for (const event of [
    { ...base, id: "call-manual", kind: "invocation", trigger: "manual" },
    { ...base, id: "call-auto", kind: "invocation", trigger: "automatic" },
    { ...base, id: "read-unknown", kind: "document", trigger: "unknown" },
    { ...base, id: "read-auto", kind: "document", trigger: "automatic" },
    { ...base, id: "request-manual", kind: "request", trigger: "manual" },
    { ...base, id: "other-tool", tool: "qoder", kind: "document", trigger: "automatic" },
  ]) store.put(event);
  const all = store.query();
  assert.deepEqual(all.counts, { invocation: 2, document: 3, request: 1, manual: 1, automatic: 3, unknown: 1 });
  // 点某个类型页签只该改变列表与 total，统计条上的四个数字必须原地不动。
  for (const kind of ["invocation", "document", "request"]) {
    const filtered = store.query({ kind });
    assert.deepEqual(filtered.counts, all.counts, `按 ${kind} 筛选不应改变统计`);
    assert.ok(filtered.total > 0 && filtered.total <= all.total);
  }
  // 触发方式同理：选中“手动”后各项统计仍是全局口径。
  assert.deepEqual(store.query({ trigger: "manual" }).counts, all.counts);
  // 其他维度的筛选仍然要收窄统计（否则数字会与列表脱节）。
  assert.equal(store.query({ tool: "qoder" }).counts.document, 1);
  assert.equal(store.query({ tool: "qoder" }).counts.manual, 0);
});

test("旧版无依据自动推断回到未知，有明确证据的手动和自动记录保留", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "activity-trigger-upgrade-"));
  let store = new UsageStore(directory);
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const base = { tool: "codex", skillName: "pdf", timestamp: 1000, sessionId: "s", project: "/demo", callId: "call",
    kind: "invocation", trigger: "automatic", status: "returned", evidence: "agent_choice",
    sourcePath: "/missing/history.jsonl", sourceLine: "2" };
  for (const event of [
    { ...base, id: "legacy-call" },
    { ...base, id: "legacy-read", kind: "document" },
    { ...base, id: "explicit-auto", evidence: "user_auto_choice" },
    { ...base, id: "manual", trigger: "manual", evidence: "user_selection" },
  ]) store.put(event);
  store.close(); store = new UsageStore(directory);
  const byId = new Map(store.query().items.map(event => [event.id, event]));
  assert.equal(byId.size, 4, "来源文件缺失也不能删除历史记录");
  assert.deepEqual([byId.get("legacy-call").trigger, byId.get("legacy-call").evidence], ["unknown", "skill_call"]);
  assert.deepEqual([byId.get("legacy-read").trigger, byId.get("legacy-read").evidence], ["unknown", "document_read"]);
  assert.equal(byId.get("explicit-auto").trigger, "automatic");
  assert.equal(byId.get("manual").trigger, "manual");
  assert.ok([...byId.values()].every(event => event.status === "returned" && event.timestamp === 1000));
  store.put({ ...base, id: "legacy-call", trigger: "manual", evidence: "user_selection" });
  store.close(); store = new UsageStore(directory);
  assert.equal(store.query().items.find(event => event.id === "legacy-call").trigger, "manual", "重扫补回的证据不被再次重置");
});
