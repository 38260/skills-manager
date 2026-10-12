import test from "node:test";
import assert from "node:assert/strict";
import { ParseContext } from "../../backend/activity/context.mjs";
import { parseCodex, documentPaths } from "../../backend/activity/codex.mjs";

export function parse(parser, tool, rows) {
  const records = new Map();
  const context = new ParseContext(tool, "/logs/session.jsonl", { put: row => records.set(row.id, { ...row }), removeRequest: id => records.delete(id) });
  rows.forEach((row, index) => parser({ timestamp: 1000 + index, ...row, line: index + 1 }, context));
  context.finish();
  return [...records.values()];
}
const codex = payload => ({ type: "response_item", payload });
test("Codex 区分手动与自动选择；确认读取后才计数，不计打印或清单", () => {
  const rows = [
    { type: "session_meta", payload: { id: "session", cwd: "/project" } },
    codex({ type: "message", role: "user", id: "user1", content: [{ type: "input_text", text: "$ui 帮我做页面" }] }),
    codex({ type: "function_call", call_id: "call1", name: "exec_command", arguments: JSON.stringify({ cmd: 'Get-Content -Raw "C:/skills/ui/SKILL.md"' }) }),
    codex({ type: "function_call_output", call_id: "call1", output: 'Process exited with code 0\n# private contents' }),
    codex({ type: "message", role: "user", content: [{ type: "input_text", text: "请自动选择合适的技能完成任务" }] }),
    codex({ type: "function_call", call_id: "call2", name: "Skill", arguments: '{"skill":"review"}' }),
    codex({ type: "function_call_output", call_id: "call2", output: { isError: true } }),
    codex({ type: "message", role: "user", content: [{ type: "input_text", text: "继续" }] }),
    codex({ type: "custom_tool_call", call_id: "call3", name: "functions.exec", input: 'await tools.exec_command({cmd: "cat /skills/ui/SKILL.md"})' }),
    codex({ type: "function_call", call_id: "echo", name: "exec_command", arguments: '{"cmd":"echo /skills/ui/SKILL.md"}' }),
  ];
  const events = parse(parseCodex, "codex", rows);
  assert.equal(events.length, 3);
  // 第三条是「读到 SKILL.md 但结果未返回」的 request 记录：这一轮有用户消息（"继续"）却没点名，
  // 按新契约判「自动触发（Agent 自选）」，不再是来源未知 —— 旧契约「非点名即 unknown」正是本次要修的。
  assert.deepEqual(events.map(e => [e.kind, e.trigger, e.status]), [["document", "manual", "returned"], ["invocation", "automatic", "failed"], ["request", "automatic", "pending"]]);
  assert.equal(parse(parseCodex, "codex", [...rows, ...rows]).length, 3);
  assert.deepEqual(documentPaths("exec_command", { cmd: 'echo "cat /skills/ui/SKILL.md"' }), []);
  assert.deepEqual(documentPaths("exec_command", { cmd: 'if false; then cat /skills/ui/SKILL.md; fi' }), []);
  assert.deepEqual(documentPaths("read_file", { path: "/skills/ui/SKILL.md" }), ["/skills/ui/SKILL.md"]);
  assert.equal(parse(parseCodex, "codex", [codex({ type: "message", role: "user", content: "$ui" })])[0].kind, "request");
  assert.ok(!JSON.stringify(events).includes("private contents"));
});

// 契约收窄后的边界：只有「本轮完全没有用户消息」才算来源未知（例如归档片段、只剩工具调用的日志）。
// 这条守住 unknown 不会被一并改掉 —— 前三类测试的 fixture 都带用户消息，覆盖不到这里。
test("没有用户消息的日志片段仍判为来源未知", () => {
  const events = parse(parseCodex, "codex", [
    codex({ type: "function_call", call_id: "call1", name: "Skill", arguments: '{"skill":"review"}' }),
    codex({ type: "function_call_output", call_id: "call1", output: 'Process exited with code 0' }),
  ]);
  assert.equal(events.length, 1);
  assert.deepEqual([events[0].kind, events[0].trigger, events[0].status], ["invocation", "unknown", "returned"]);
});
