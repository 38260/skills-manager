import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { zstdCompressSync } from "node:zlib";
import { readRecords } from "../../backend/activity/readers.mjs";
import { ParseContext } from "../../backend/activity/context.mjs";
import { parseDsh } from "../../backend/activity/dsh.mjs";

test("DSH 逐帧读取、触发方式、结果关联和截断前缀保留", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "activity-dsh-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const rows = [
    { type: "session", version: 4, id: "s", cwd: "/demo" },
    { type: "user/message", data: { id: "u", source: { kind: "user" }, content: "$design" } },
    { type: "tool/call", data: { name: "skill", callId: "c", arguments: '{"name":"design"}' } },
    { type: "tool/result", data: { message: { toolCallId: "c", isError: false } } },
    { type: "user/message", data: { source: { kind: "user" }, content: "请自动选择合适的技能完成任务" } },
    { type: "tool/call", data: { name: "skill", callId: "c2", arguments: '{"name":"design"}' } },
    { type: "tool/result", data: { message: { toolCallId: "c2", isError: true } } },
    { type: "user/message", data: { source: { kind: "user" }, content: "继续" } },
    { type: "user/message", data: { source: { kind: "runtime-context" }, content: "$design" } },
    { type: "tool/call", data: { name: "skill", callId: "c3", arguments: '{"name":"design"}' } },
  ];
  const frames = rows.map((row, i) => zstdCompressSync(Buffer.from(JSON.stringify({ time: 1000 + i, ...row }) + "\n")));
  const filename = path.join(directory, "s.v4.jsonl.zstd");
  fs.writeFileSync(filename, Buffer.concat([...frames, zstdCompressSync(Buffer.from('unfinished')).subarray(0, 6)]));
  const events = new Map();
  const ctx = new ParseContext("dsh", filename, { put: row => events.set(row.id, { ...row }) });
  await assert.rejects(async () => {
    for await (const item of readRecords(filename, { compressed: true })) parseDsh(item.row, ctx);
  });
  ctx.finish();
  assert.equal(events.size, 3);
  // “继续”之后未点名的调用由 Agent 自行选择。
  assert.deepEqual([...events.values()].map(e => [e.trigger, e.status]), [["manual", "returned"], ["automatic", "failed"], ["automatic", "pending"]]);
  fs.writeFileSync(filename, Buffer.concat(frames));
  for await (const item of readRecords(filename, { compressed: true })) parseDsh(item.row, ctx);
  assert.equal(events.size, 3);
  assert.throws(() => parseDsh({ type: "session", version: 999 }, ctx), /版本/);
});

test("DSH 早期版本 0 的会话按同一结构解析", () => {
  const events = new Map();
  const ctx = new ParseContext("dsh", "/logs/session.jsonl.zstd", { put: row => events.set(row.id, { ...row }) });
  const rows = [
    { type: "session", version: 0, id: "s", cwd: "/legacy" },
    { type: "user/message", data: { source: { kind: "user" }, content: "$legacy-skill" } },
    { type: "tool/call", data: { name: "skill", callId: "c0", arguments: '{"name":"legacy-skill"}' } },
    { type: "tool/result", data: { message: { toolCallId: "c0", isError: false } } },
  ];
  rows.forEach((row, index) => parseDsh({ time: 1000 + index, line: index + 1, ...row }, ctx));
  ctx.finish();
  assert.equal(events.size, 1);
  const [event] = [...events.values()];
  assert.deepEqual([event.skillName, event.trigger, event.project], ["legacy-skill", "manual", "/legacy"]);
});

test("DSH 菜单点选注入的 skill-invocation 记为手动调用", () => {
  const events = new Map();
  const sink = { put: row => events.set(row.id, { ...row }), removeRequest: id => events.delete(id) };
  const ctx = new ParseContext("dsh", "/logs/session.v4.jsonl.zstd", sink);
  const rows = [
    { type: "session", version: 4, id: "s", cwd: "/demo" },
    // 真实 DSH：菜单点选后用户消息以 /技能名 开头，技能正文由客户端注入，全程没有 skill 工具调用。
    { type: "user/message", data: { id: "u1", source: { kind: "user" }, content: "/animation-vocabulary  popover 回弹效果叫什么？" } },
    { type: "user/message", data: { id: "u2", source: { kind: "skill-catalog" }, content: "<available_skills>- `animation-vocabulary`: glossary</available_skills>" } },
    { type: "user/message", data: { id: "m1", source: { kind: "skill-invocation", name: "animation-vocabulary", form: "instructions" }, content: '<skill_content name="animation-vocabulary">正文</skill_content>' } },
  ];
  rows.forEach((row, index) => parseDsh({ time: 1000 + index, line: index + 1, ...row }, ctx));
  ctx.finish();
  assert.equal(events.size, 1, "注入的技能正文只记一次调用");
  const [event] = [...events.values()];
  assert.deepEqual([event.skillName, event.kind, event.trigger, event.status, event.evidence],
    ["animation-vocabulary", "invocation", "manual", "returned", "user_selection"]);
});
