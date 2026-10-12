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
  assert.deepEqual([...events.values()].map(e => [e.trigger, e.status]), [["manual", "returned"], ["automatic", "failed"], ["automatic", "pending"]]);
  parseQoder({ type: "user", line: 50, message: { content: "<command-name>/help</command-name>" } }, ctx);ctx.finish();
  assert.equal(events.size, 3);
});
