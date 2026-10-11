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
