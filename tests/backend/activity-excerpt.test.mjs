import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { zstdCompressSync } from "node:zlib";
import { activityExcerpt } from "../../backend/activity/excerpt.mjs";
import { ActivityService } from "../../backend/activity/service.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "activity-excerpt-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("普通日志只返回目标行前后两行，缺失与越界给出原因", async t => {
  const root = fixture(t), file = path.join(root, "session.jsonl");
  const rows = Array.from({ length: 8 }, (_, index) => ({ seq: index + 1 }));
  fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join("\n") + "\n");

  const result = await activityExcerpt({ tool: "codex", sourcePath: file, sourceLine: "4" });
  assert.equal(result.available, true);
  assert.equal(result.kind, "jsonl");
  assert.equal(result.lineKind, "line");
  assert.equal(result.focus, "4");
  assert.deepEqual(result.lines.map(line => line.label), ["2", "3", "4", "5", "6"]);
  assert.match(result.lines[2].text, /"seq":4/);

  const missing = await activityExcerpt({ tool: "codex", sourcePath: path.join(root, "missing.jsonl"), sourceLine: "1" });
  assert.equal(missing.available, false);
  assert.equal(missing.reason, "missing");

  const absent = await activityExcerpt({ tool: "codex", sourcePath: file, sourceLine: "99" });
  assert.equal(absent.available, false);
  assert.equal(absent.reason, "not_found");
});

test("超长日志行截断展示，压缩日志按解压后的行号取片段", async t => {
  const root = fixture(t), long = path.join(root, "long.jsonl");
  fs.writeFileSync(long, JSON.stringify({ payload: "x".repeat(5000) }) + "\n");
  const clipped = await activityExcerpt({ tool: "codex", sourcePath: long, sourceLine: "1" });
  assert.equal(clipped.available, true);
  assert.equal(clipped.truncated, true);
  assert.ok(clipped.lines[0].text.endsWith("…"));
  assert.ok(clipped.lines[0].text.length <= 4001);

  const compressed = path.join(root, "session.jsonl.zstd");
  const body = [1, 2, 3].map(seq => JSON.stringify({ seq })).join("\n") + "\n";
  fs.writeFileSync(compressed, zstdCompressSync(Buffer.from(body)));
  const result = await activityExcerpt({ tool: "dsh", sourcePath: compressed, sourceLine: "2" });
  assert.equal(result.kind, "zstd");
  assert.deepEqual(result.lines.map(line => line.label), ["1", "2", "3"]);
  assert.match(result.lines[1].text, /"seq":2/);
  assert.doesNotMatch(result.lines[1].text, /"line":/, "注入的读取行号不应混进片段 JSON");
});

test("ZCode 来源按 part:<id> 展示对应的 JSON，找不到 part 不猜相邻记录", async t => {
  const root = fixture(t), filename = path.join(root, "db.sqlite");
  const db = new DatabaseSync(filename);
  db.exec("CREATE TABLE part(id TEXT PRIMARY KEY,data TEXT)");
  db.prepare("INSERT INTO part(id,data) VALUES(?,?)").run("p1", JSON.stringify({ type: "tool", tool: "Skill", state: { input: { skill: "ui" } } }));
  db.close();

  const result = await activityExcerpt({ tool: "zcode", sourcePath: filename, sourceLine: "part:p1" });
  assert.equal(result.available, true);
  assert.equal(result.kind, "zcode");
  assert.equal(result.lineKind, "part");
  assert.equal(result.lines[0].label, "part:p1");
  assert.match(result.lines[0].text, /"skill": "ui"/);

  const absent = await activityExcerpt({ tool: "zcode", sourcePath: filename, sourceLine: "part:nope" });
  assert.equal(absent.available, false);
  assert.equal(absent.reason, "not_found");
});

test("服务命令按记录 id 读取片段，未知记录直接报错", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "activity-excerpt-service-"));
  const log = path.join(root, "session.jsonl");
  fs.writeFileSync(log, JSON.stringify({ seq: 1 }) + "\n");
  const service = new ActivityService({ directory: path.join(root, "usage"), home: root, env: {}, interval: 0 });
  t.after(async () => { await service.close(); fs.rmSync(root, { recursive: true, force: true }); });
  service.store.put({ id: "event-1", tool: "codex", skillName: "ui", timestamp: 1000, sessionId: "s", project: "/demo",
    callId: "c1", kind: "invocation", trigger: "automatic", status: "returned", evidence: "agent_choice",
    sourcePath: log, sourceLine: "1" });

  const result = await service.commands.get_skill_activity_excerpt.call({ id: "event-1" });
  assert.equal(result.available, true);
  assert.match(result.lines[0].text, /"seq":1/);
  await assert.rejects(() => service.commands.get_skill_activity_excerpt.call({ id: "unknown" }), /找不到这条调用记录/);
});

test("完整长行先解码再提取，4000 字符之后的目标命令仍能展示", async t => {
  const root = fixture(t), file = path.join(root, "late-evidence.jsonl");
  const command = 'Get-Content "C:\\skills\\ponytail\\SKILL.md"\nWrite-Output done';
  fs.writeFileSync(file, JSON.stringify({ metadata: "x".repeat(6000), type: "response_item", payload: {
    type: "function_call", name: "exec_command", call_id: "call-1", arguments: JSON.stringify({ cmd: command }),
  } }) + "\n");
  const result = await activityExcerpt({ tool: "codex", sourcePath: file, sourceLine: "1", skillName: "ponytail" });
  assert.equal(result.truncated, true);
  assert.equal(result.lines[0].summary.content, command);
  assert.equal(result.lines[0].summary.toolName, "exec_command");
  assert.equal(result.lines[0].summary.format, "command");
  assert.equal(result.lines[0].summary.parsed, true);
  assert.equal(result.lines[0].summary.truncated, false);
});

test("解码后仍很长的脚本围绕目标技能展示，损坏原文明确回退", async t => {
  const root = fixture(t), file = path.join(root, "script.jsonl");
  fs.writeFileSync(file, JSON.stringify({ type: "response_item", payload: {
    type: "custom_tool_call", name: "functions.exec", input: `${"x".repeat(7000)}\nGet-Content ponytail/SKILL.md\n${"y".repeat(3000)}`,
  } }) + "\n{broken-json\n");
  const result = await activityExcerpt({ tool: "codex", sourcePath: file, sourceLine: "1", skillName: "ponytail" });
  assert.match(result.lines[0].summary.content, /Get-Content ponytail\/SKILL.md/);
  assert.equal(result.lines[0].summary.truncated, true);
  assert.equal(result.lines[1].summary.parsed, false);
  assert.equal(result.lines[1].summary.content, "{broken-json");
});

test("压缩与 SQLite 日志同样返回可读证据", async t => {
  const root = fixture(t), file = path.join(root, "dsh.jsonl.zstd");
  fs.writeFileSync(file, zstdCompressSync(Buffer.from(JSON.stringify({ type: "tool/call", data: { name: "skill", callId: "c", arguments: '{"name":"ponytail"}' } }) + "\n")));
  const result = await activityExcerpt({ tool: "dsh", sourcePath: file, sourceLine: "1" });
  assert.equal(result.lines[0].summary.toolName, "skill");
  assert.match(result.lines[0].summary.content, /ponytail/);
  const dbFile = path.join(root, "parts.sqlite"), db = new DatabaseSync(dbFile);
  db.exec("CREATE TABLE part(id TEXT PRIMARY KEY,data TEXT)");
  db.prepare("INSERT INTO part VALUES(?,?)").run("p", JSON.stringify({ type: "tool", tool: "Skill", state: { input: { skill: "ponytail" } } }));
  db.close();
  const part = await activityExcerpt({ tool: "zcode", sourcePath: dbFile, sourceLine: "part:p" });
  assert.equal(part.lines[0].summary.toolName, "Skill");
  assert.match(part.lines[0].summary.content, /ponytail/);
});
