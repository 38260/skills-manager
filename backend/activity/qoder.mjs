import { resultStatus } from "./context.mjs";

export function parseQoder(row, ctx) {
  if (row.sessionId) ctx.sessionId = row.sessionId;
  if (row.cwd) ctx.project = row.cwd;
  if (["workspace-directories", "runtime-config"].includes(row.type)) ctx.recognized++;
  if (!["user", "assistant"].includes(row.type) || !row.message) return;
  ctx.recognized++;
  const content = row.message.content;
  const parts = Array.isArray(content) ? content : [];
  // 上下文压缩摘要由客户端注入成一条用户消息，里面整段引用的是历史指令，
  // 不能当成新的用户点名（否则摘要里的引号、省略号都会被抽成技能名）。
  if (row.isCompactSummary === true) return;
  if (row.type === "user" && !parts.some(item => item.type === "tool_result") && row.humanInput !== false) ctx.user(content, row);
  for (const part of parts) {
    if (row.type === "assistant" && part.type === "tool_use" && part.name === "Skill") {
      ctx.call({ id: part.id, name: part.input?.skill, row });
    }
    if (part.type === "tool_result") {
      const status = part.is_error === undefined ? "returned" : resultStatus(part);
      ctx.result(part.tool_use_id, status);
    }
  }
}
