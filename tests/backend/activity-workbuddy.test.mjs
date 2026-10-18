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

function parse(rows) {
  const events = new Map();
  const sink = { put: row => events.set(row.id, { ...row }), removeRequest: id => events.delete(id) };
  const ctx = new ParseContext("workbuddy", "/logs/real.jsonl", sink);
  rows.forEach((row, index) => parseWorkbuddy({ sessionId: "s", timestamp: 1000, line: index + 1, ...row }, ctx));
  ctx.finish();
  return [...events.values()];
}

const reminder = (body, query) => String.raw`<system-reminder data-role="user-context">
<user_info>
Workspace Folder: D:/AIWorkSpace/Codex/SkillManager
</user_info>
${body}
</system-reminder>
<user_query>${query}</user_query>`;

test("WorkBuddy 识别技能芯片和附加技能块，不再产生 tool 请求", () => {
  const body = String.raw`<manually_attached_skills>
Please use the Skill tool to invoke this skill.
name: eli5
description: Explain a topic like I'm a 5 year old.
path: C:\Users\me\.workbuddy\skills\eli5\SKILL.md
</manually_attached_skills>`;
  const query = String.raw`@skill:"C:\Users\me\.workbuddy\skills\eli5\SKILL.md" 用最简单的比喻解释什么是数据库索引，三句话以内。`;
  const events = parse([
    { type: "message", role: "user", content: reminder(body, query) },
    { type: "function_call", callId: "c1", name: "Skill", arguments: '{"skill":"eli5"}' },
    { type: "function_call_result", callId: "c1", status: "completed" },
  ]);
  assert.equal(events.length, 1);
  const [event] = events;
  assert.deepEqual([event.skillName, event.kind, event.trigger, event.status], ["eli5", "invocation", "manual", "returned"]);
  assert.ok(!events.some(item => item.skillName === "tool"), "附加技能说明不能被解析成 tool 请求");
});

test("WorkBuddy 从 user_query 识别自动选择", () => {
  const events = parse([
    { type: "message", role: "user", content: reminder("", "请自动选择技能，帮我查一下今天最新的 AI 新闻，给我三条并附来源。") },
    { type: "function_call", callId: "c1", name: "Skill", arguments: '{"skill":"aihot"}' },
    { type: "function_call_result", callId: "c1", status: "completed" },
  ]);
  assert.equal(events.length, 1);
  assert.deepEqual([events[0].skillName, events[0].trigger], ["aihot", "automatic"]);
});

test("WorkBuddy 点名但未执行只记录待确认请求", () => {
  const events = parse([
    { type: "message", role: "user", content: reminder("", "请使用 eli5 技能来回答：什么是数据库索引？但这次只说明你会怎么用这个技能，不要实际调用任何工具或技能。") },
  ]);
  assert.equal(events.length, 1);
  assert.deepEqual([events[0].skillName, events[0].kind, events[0].trigger, events[0].status, events[0].evidence],
    ["eli5", "request", "manual", "pending", "user_selection"]);
});

test("WorkBuddy 仅提及或否定使用不产生调用和请求", () => {
  const events = parse([
    { type: "message", role: "user", content: reminder("", "eli5 这个技能是做什么的？只回答它的描述，不要调用任何技能。") },
    { type: "function_call", callId: "c1", name: "Read", arguments: String.raw`{"file_path":"C:\Users\me\.workbuddy\skills\eli5\SKILL.md"}` },
    { type: "function_call_result", callId: "c1", status: "completed" },
  ]);
  assert.equal(events.length, 0);
});

test("WorkBuddy 普通任务未点名技能时归为 Agent 自选", () => {
  const events = parse([
    { type: "message", role: "user", content: reminder("", "给五岁小孩解释一下什么是量子纠缠，三句话以内。") },
    { type: "function_call", callId: "c1", name: "Skill", arguments: '{"skill":"eli5"}' },
    { type: "function_call_result", callId: "c1", status: "completed" },
  ]);
  assert.equal(events.length, 1);
  assert.deepEqual([events[0].skillName, events[0].trigger, events[0].evidence], ["eli5", "automatic", "agent_choice"]);
});

test("WorkBuddy 从带引号的 SKILL.md 路径推导技能名", () => {
  const query = String.raw`@skill:'C:\Users\me\.workbuddy\skills\foo\SKILL.md' 执行任务`;
  const events = parse([
    { type: "message", role: "user", content: reminder("", query) },
    { type: "function_call", callId: "c1", name: "Skill", arguments: '{"skill":"foo"}' },
    { type: "function_call_result", callId: "c1", status: "completed" },
  ]);
  assert.equal(events.length, 1);
  assert.deepEqual([events[0].skillName, events[0].trigger], ["foo", "manual"]);
});

test("WorkBuddy 技能芯片的转义反斜杠路径仍推导出技能名", () => {
  const file = String.raw`C:\Users\me\.workbuddy\skills\eli5\SKILL.md`;
  // 真实 WorkBuddy 把芯片路径按 JSON 字符串再转义一次，日志里是双反斜杠。
  const chip = JSON.stringify(file).slice(1, -1);
  const body = String.raw`<manually_attached_skills>
Please use the Skill tool to invoke this skill.
name: eli5
description: Explain a topic like I'm a 5 year old.
path: C:\Users\me\.workbuddy\skills\eli5\SKILL.md
</manually_attached_skills>`;
  const events = parse([
    { type: "message", role: "user", content: reminder(body, `@skill:"${chip}" 解释什么是数据库索引。`) },
    { type: "function_call", callId: "c1", name: "Skill", arguments: '{"skill":"eli5"}' },
    { type: "function_call_result", callId: "c1", status: "completed" },
  ]);
  assert.equal(events.length, 1);
  assert.deepEqual([events[0].skillName, events[0].kind, events[0].trigger], ["eli5", "invocation", "manual"]);

  const requests = parse([
    { type: "message", role: "user", content: reminder(body, `@skill:"${chip}" 解释什么是数据库索引。`) },
  ]);
  assert.equal(requests.length, 1, "附加技能块与芯片指向同一技能时只能登记一次");
  assert.deepEqual([requests[0].skillName, requests[0].skillPath], ["eli5", file]);
});
