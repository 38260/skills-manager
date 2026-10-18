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
  // “继续”没有点名技能，后续未完成的文档读取仍由 Agent 自行选择。
  assert.deepEqual(events.map(e => [e.kind, e.trigger, e.status]), [["document", "manual", "returned"], ["invocation", "automatic", "failed"], ["request", "automatic", "pending"]]);
  assert.equal(parse(parseCodex, "codex", [...rows, ...rows]).length, 3);
  assert.deepEqual(documentPaths("exec_command", { cmd: 'echo "cat /skills/ui/SKILL.md"' }), []);
  assert.deepEqual(documentPaths("exec_command", { cmd: 'if false; then cat /skills/ui/SKILL.md; fi' }), []);
  assert.deepEqual(documentPaths("read_file", { path: "/skills/ui/SKILL.md" }), ["/skills/ui/SKILL.md"]);
  assert.equal(parse(parseCodex, "codex", [codex({ type: "message", role: "user", content: "$ui" })])[0].kind, "request");
  assert.ok(!JSON.stringify(events).includes("private contents"));
});

test("没有用户消息的日志片段仍判为来源未知", () => {
  const events = parse(parseCodex, "codex", [
    codex({ type: "function_call", call_id: "call1", name: "Skill", arguments: '{"skill":"review"}' }),
    codex({ type: "function_call_output", call_id: "call1", output: 'Process exited with code 0' }),
  ]);
  assert.equal(events.length, 1);
  assert.deepEqual([events[0].kind, events[0].trigger, events[0].status], ["invocation", "unknown", "returned"]);
});

test("明确的自然语言点名是手动；有用户任务但未点名的调用归为自动", () => {
  const invoke = (message, skill = "pdf") => parse(parseCodex, "codex", [
    codex({ type: "message", role: "user", id: "u", content: message }),
    codex({ type: "function_call", call_id: "c", name: "Skill", arguments: JSON.stringify({ skill }) }),
    codex({ type: "function_call_output", call_id: "c", output: "Process exited with code 0" }),
  ]).find(event => event.callId === "c");
  for (const message of ["请使用 pdf 技能处理文档", "请调用技能 pdf", "帮我用 `pdf` 技能读文件",
    "Please use the pdf skill", "Invoke skill pdf", "$pdf 读取文档", "请用 @skill:pdf 读取文档"]) {
    const event = invoke(message);
    assert.deepEqual([event.trigger, event.evidence], ["manual", "user_selection"], message);
  }
  for (const message of ["处理文档", "继续", "pdf 技能支持什么？", "如何使用 pdf 技能？",
    "不要使用 pdf 技能", "请不要调用技能 pdf", "Do not use the pdf skill", "use the document",
    "示例：\n```text\n请使用 pdf 技能\n```", "> 请使用 pdf 技能", "这是 pdf-converter 的说明"]) {
    const event = invoke(message);
    assert.deepEqual([event.trigger, event.evidence], ["automatic", "agent_choice"], message);
  }
  assert.equal(invoke("请使用 pdf-converter 技能", "pdf-converter").trigger, "manual");
  assert.equal(invoke("请使用 pdf-converter 技能", "pdf").trigger, "automatic", "点了别的技能，当前技能只能是 Agent 自选");
  assert.equal(invoke("请自动选择合适的技能处理文档").trigger, "automatic");
});

test("自然语言点名的重复识别保留客户端提供的技能路径", () => {
  const ctx = new ParseContext("codex", "/logs/demo.jsonl", { put() {} });
  ctx.user("请使用 pdf 技能", { line: 1 }, [{ name: "pdf", path: "/skills/pdf/SKILL.md" }]);
  assert.equal(ctx.selections.size, 1);
  assert.equal(ctx.selections.get("pdf").request.skillPath, "/skills/pdf/SKILL.md");
});
