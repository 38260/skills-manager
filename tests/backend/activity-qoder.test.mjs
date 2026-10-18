import test from "node:test";
import assert from "node:assert/strict";
import { ParseContext } from "../../backend/activity/context.mjs";
import { parseQoder } from "../../backend/activity/qoder.mjs";

test("Qoder 关联 slash 选择和工具结果，重复事件不增次，累计统计不混入", () => {
  const events = new Map(), ctx = new ParseContext("qoder", "/logs/a.jsonl", { put: e => events.set(e.id, { ...e }) });
  const rows = [
    { type: "user", uuid: "u", message: { content: "<command-message>design</command-message>\n<command-name>/design</command-name>" } },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Skill", id: "c", input: { skill: "design" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "c", content: "private" }] } },
    { type: "user", message: { content: "请自动选择合适的技能完成任务" } },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Skill", id: "c2", input: { skill: "review" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "c2", is_error: true }] } },
    { type: "user", message: { content: "继续" } },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Skill", id: "c3", input: { skill: "review" } }] } },
    { type: "skill-usage", skill: "review", count: 100 },
  ];
  [...rows, ...rows].forEach((r, i) => parseQoder({ sessionId: "s", cwd: "/demo", timestamp: 1000, line: i + 1, ...r }, ctx));
  ctx.finish();
  assert.equal(events.size, 3);
  assert.deepEqual([...events.values()].map(e => [e.trigger, e.status]), [["manual", "returned"], ["automatic", "failed"], ["unknown", "pending"]]);
  parseQoder({ type: "user", line: 50, message: { content: "<command-name>/help</command-name>" } }, ctx);ctx.finish();
  assert.equal(events.size, 3);
});

test("Qoder 压缩摘要里的历史指令不作为用户点名", () => {
  const events = new Map();
  const ctx = new ParseContext("qoder", "/logs/b.jsonl", { put: e => events.set(e.id, { ...e }), removeRequest: id => events.delete(id) });
  const rows = [
    // 真实形态：客户端在压缩边界注入一条用户消息，整段是历史会话摘要，里面引用过点名句式和省略号。
    { type: "user", uuid: "sum", isCompactSummary: true, isVisibleInTranscriptOnly: true,
      message: { role: "user", content: [{ type: "text", text: "This session is being continued from a previous conversation.\nSummary:\n   - 请使用 eli5 技能来回答：什么是数据库索引？\n   - 用户原话：... \n   - 调用 ... 技能完成" }] } },
    { type: "user", uuid: "real", message: { role: "user", content: [{ type: "text", text: "继续" }] } },
  ];
  rows.forEach((r, i) => parseQoder({ sessionId: "s", timestamp: 1000, line: i + 1, ...r }, ctx));
  ctx.finish();
  assert.equal(events.size, 0, "压缩摘要与「继续」都不该产生请求");
});
