import test from "node:test";
import assert from "node:assert/strict";
import { evidenceSummary } from "../../backend/activity/evidence.mjs";

test("Qoder 多工具记录按 callId 定位本次调用，不取同一行第一个技能", () => {
  const row = { type: "assistant", message: { content: [
    { type: "tool_use", id: "a", name: "Skill", input: { skill: "other" } },
    { type: "tool_use", id: "b", name: "Skill", input: { skill: "ponytail" } },
  ] } };
  const summary = evidenceSummary(row, { callId: "b", skillName: "ponytail" });
  assert.equal(summary.callId, "b");
  assert.match(summary.content, /ponytail/);
  assert.doesNotMatch(summary.content, /other/);
});

test("WorkBuddy 与 WorkBuddy AI 的参数、消息和真实返回逐条投影", () => {
  assert.deepEqual(evidenceSummary({ type: "function_call", name: "Skill", callId: "c", arguments: '{"command":"ponytail"}' }), {
    role: "call", toolName: "Skill", callId: "c", content: "ponytail", format: "command", parsed: true, truncated: false,
  });
  const result = evidenceSummary({ type: "function_call_result", callId: "other", output: "returned" });
  assert.equal(result.role, "result");
  assert.equal(result.callId, "other", "相邻返回保留自己的调用 ID，不冒充目标调用");
  assert.equal(evidenceSummary({ type: "message", role: "user", content: "使用 ponytail" }).content, "使用 ponytail");
});

test("未知日志格式保留原文且标记未识别，消息正文不带包装元数据", () => {
  assert.equal(evidenceSummary({ unknown: true }).parsed, false);
  const message = evidenceSummary({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "使用 ponytail" }] } });
  assert.equal(message.role, "user");
  assert.equal(message.content, "使用 ponytail");
});
