import test from "node:test";
import assert from "node:assert/strict";
import { ParseContext } from "../../backend/activity/context.mjs";
import { parseCodex } from "../../backend/activity/codex.mjs";
import { userInstructionText } from "../../backend/activity/user-instructions.mjs";

function requests(text, selections = []) {
  const events = [];
  const ctx = new ParseContext("codex", "/logs/demo.jsonl", { put: event => events.push(event) });
  ctx.user(text, { line: 1, timestamp: 1000 }, selections);
  ctx.finish();
  return events;
}

test("技能说明的泛指句不生成 this 等伪技能请求", () => {
  for (const text of ["Use this skill to automate the UI of Microsoft Windows apps.",
    "Please use the this skill when editing.", "Use that skill for documents.",
    "Invoke your skill here.", "Call these skills when needed."]) {
    assert.deepEqual(requests(text), [], text);
  }
  assert.equal(userInstructionText("Please use the pdf skill"), "Please use the pdf skill");
  assert.equal(userInstructionText("请使用 pdf 技能"), "请使用 pdf 技能");
});

test("审批引用、注入技能说明、代码与引用不构成当前用户点名", () => {
  for (const text of [
    "The following is the Codex agent history whose request action you are assessing.\nUse this skill to automate apps.\n$history",
    "<skills_instructions>\n$history\n请使用 pdf 技能\n</skills_instructions>",
    "<skill_instructions>\n/skill history\n</skill_instructions>",
    "<skill>\n@skill:history\n</skill>",
    "<skill>\n$history",
    "```text\n$history\n```", "> @skill:history",
  ]) assert.deepEqual(requests(text), [], text);
  assert.deepEqual(requests("<skills_instructions>\n$history\n</skills_instructions>\n$pdf").map(e => e.skillName), ["pdf"]);
});

test("真实显式点名和客户端选择保留，包括名为 this 的技能", () => {
  for (const text of ["$this", "/skill this", "请用 @skill:this"]) {
    const [event] = requests(text);
    assert.equal(event.skillName, "this");
    assert.equal(event.kind, "request");
    assert.equal(event.trigger, "manual");
  }
  const events = [];
  const ctx = new ParseContext("codex", "/logs/demo.jsonl", { put: event => events.push(event) });
  parseCodex({ type: "response_item", line: 1, payload: { type: "message", role: "user", content: [
    { type: "skill", name: "this", path: "/skills/this/SKILL.md" },
    { type: "input_text", text: "Use this skill for editing." },
  ] } }, ctx);
  ctx.finish();
  assert.equal(events.length, 1);
  assert.equal(events[0].skillPath, "/skills/this/SKILL.md");
});
