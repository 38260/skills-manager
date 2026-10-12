import test from "node:test";
import assert from "node:assert/strict";
import { ParseContext } from "../../backend/activity/context.mjs";
import { parseWorkbuddy } from "../../backend/activity/workbuddy.mjs";

test("WorkBuddy 只统计顶层调用，关联重复文件与结果，触发方式分开", () => {
  const events = new Map(), sink = { put: row => events.set(row.id, { ...row }) };
  const rows = [
    { type: "message", role: "user", id: "u1", content: "/skill design" },
    { type: "function_call", callId: "c1", name: "Skill", arguments: '{"skill":"design","args":"private"}', message: { content: [{ type: "tool_use", name: "Skill", id: "nested", input: { skill: "design" } }] } },
    { type: "function_call_result", callId: "c1", status: "completed", output: "private" },
    { type: "message", role: "user", content: "请自动选择合适的技能完成任务" },
    { type: "function_call", callId: "c2", name: "Skill", arguments: '{"skill":"design"}' },
    { type: "function_call_result", callId: "c2", status: "failed" },
    { type: "message", role: "user", content: "继续" },
    { type: "function_call", callId: "c3", name: "Skill", arguments: '{"skill":"design"}' },
  ];
  for (const file of ["/logs/a.jsonl", "/logs/copy.jsonl"]) {
    const ctx = new ParseContext("workbuddy", file, sink);
    rows.forEach((r, i) => parseWorkbuddy({ sessionId: "s", timestamp: 1000, line: i + 1, ...r }, ctx)); ctx.finish();
  }
  assert.equal(events.size, 3);
  assert.deepEqual([...events.values()].map(e => [e.trigger, e.status]), [["manual", "returned"], ["automatic", "failed"], ["automatic", "pending"]]);
  assert.ok(!JSON.stringify([...events.values()]).includes("private"));
});

test("WorkBuddy 兼容 command 参数键且不再记为读取问题", () => {
  const events = new Map(), sink = { put: row => events.set(row.id, { ...row }) };
  const rows = [
    { type: "message", role: "user", content: "/skill skill-creator" },
    { type: "function_call", callId: "c1", name: "Skill", arguments: '{"command":"skill-creator"}' },
    { type: "function_call_result", callId: "c1", status: "completed" },
  ];
  const ctx = new ParseContext("workbuddy", "/logs/a.jsonl", sink);
  rows.forEach((r, i) => parseWorkbuddy({ sessionId: "s", timestamp: 1000, line: i + 1, ...r }, ctx));
  ctx.finish();
  assert.equal(events.size, 1);
  const [event] = [...events.values()];
  assert.deepEqual([event.skillName, event.trigger, event.status], ["skill-creator", "manual", "returned"]);
  assert.equal(ctx.errors, 0);
});
