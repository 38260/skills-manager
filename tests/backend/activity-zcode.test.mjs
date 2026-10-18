import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { readZcode } from "../../backend/activity/zcode.mjs";

test("ZCode 从活跃 WAL 只读获取已提交状态，重新扫描更新同一调用", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "activity-zcode-")), filename = path.join(directory, "db.sqlite");
  const writer = new DatabaseSync(filename);
  t.after(() => { writer.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  writer.exec(`PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
    CREATE TABLE session(id TEXT PRIMARY KEY,directory TEXT);
    CREATE TABLE message(id TEXT PRIMARY KEY,data TEXT);
    CREATE TABLE part(id TEXT PRIMARY KEY,session_id TEXT,message_id TEXT,time_created INTEGER,data TEXT);
    INSERT INTO session VALUES('s','/demo'); INSERT INTO message VALUES('u','{"role":"user"}');
    INSERT INTO message VALUES('a','{"role":"assistant"}');`);
  const insert = writer.prepare("INSERT INTO part VALUES(?,'s',?,?,?)");
  insert.run("u", "u", 1000, JSON.stringify({ type: "text", text: "$design" }));
  const call = { type: "tool", tool: "Skill", callID: "c", state: { status: "running", input: { skill: "design", args: "private" } } };
  insert.run("a", "a", 2000, JSON.stringify(call));
  const events = new Map(), sink = { put: row => events.set(row.id, { ...row }) };
  const before = fs.readFileSync(filename), wal = fs.readFileSync(filename + "-wal");
  assert.equal(readZcode(filename, sink).errors, 0);
  assert.equal(events.size, 1); assert.equal([...events.values()][0].trigger, "manual");
  assert.equal([...events.values()][0].status, "pending");
  assert.deepEqual(fs.readFileSync(filename), before); assert.deepEqual(fs.readFileSync(filename + "-wal"), wal);
  writer.prepare("UPDATE part SET data=? WHERE id='a'").run(JSON.stringify({ ...call, state: { ...call.state, status: "completed" } }));
  readZcode(filename, sink);
  assert.equal(events.size, 1); assert.equal([...events.values()][0].status, "returned");
  writer.exec("BEGIN;"); writer.prepare("UPDATE part SET data=? WHERE id='a'").run(JSON.stringify({ ...call, state: { ...call.state, status: "error" } }));
  readZcode(filename, sink); assert.equal([...events.values()][0].status, "returned", "未提交的状态不可见");
  writer.exec("COMMIT;"); readZcode(filename, sink); assert.equal([...events.values()][0].status, "failed");
  assert.ok(!JSON.stringify([...events.values()]).includes("private"));
});

test("ZCode 桌面端技能芯片 [$技能名](SKILL.md) 记为手动触发", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "activity-zcode-chip-")), filename = path.join(directory, "db.sqlite");
  const writer = new DatabaseSync(filename);
  t.after(() => { writer.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  writer.exec(`CREATE TABLE session(id TEXT PRIMARY KEY,directory TEXT);
    CREATE TABLE message(id TEXT PRIMARY KEY,data TEXT);
    CREATE TABLE part(id TEXT PRIMARY KEY,session_id TEXT,message_id TEXT,time_created INTEGER,data TEXT);
    INSERT INTO session VALUES('s','/demo');
    INSERT INTO message VALUES('u','{"role":"user"}'); INSERT INTO message VALUES('a','{"role":"assistant"}');`);
  // 真实形态：芯片是 markdown 链接，开头的方括号会让裸 `$技能名` 锚定失效。
  writer.prepare("INSERT INTO part VALUES(?,?,?,?,?)").run("u", "s", "u", 1000,
    JSON.stringify({ type: "text", text: String.raw`[$animation-vocabulary](C:\Users\me\.agents\skills\animation-vocabulary\SKILL.md)  popover 弹一下再落定叫什么？` }));
  writer.prepare("INSERT INTO part VALUES(?,?,?,?,?)").run("a", "s", "a", 2000,
    JSON.stringify({ type: "tool", tool: "Skill", callID: "c", state: { status: "completed", input: { skill: "animation-vocabulary" } } }));
  const events = new Map(), sink = { put: row => events.set(row.id, { ...row }) };
  readZcode(filename, sink);
  assert.equal(events.size, 1);
  const [event] = [...events.values()];
  assert.deepEqual([event.skillName, event.kind, event.trigger, event.status, event.evidence],
    ["animation-vocabulary", "invocation", "manual", "returned", "user_selection"]);
});
