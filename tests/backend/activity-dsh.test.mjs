import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { zstdCompressSync } from "node:zlib";
import { readRecords } from "../../backend/activity/readers.mjs";
import { ParseContext } from "../../backend/activity/context.mjs";
import { parseDsh } from "../../backend/activity/dsh.mjs";

test("DSH 逐帧读取、三类触发、结果关联和截断前缀保留", async t => {
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
  assert.deepEqual([...events.values()].map(e => [e.trigger, e.status]), [["manual", "returned"], ["automatic", "failed"], ["unknown", "pending"]]);
  fs.writeFileSync(filename, Buffer.concat(frames));
  for await (const item of readRecords(filename, { compressed: true })) parseDsh(item.row, ctx);
  assert.equal(events.size, 3);
  assert.throws(() => parseDsh({ type: "session", version: 999 }, ctx), /版本/);
});
