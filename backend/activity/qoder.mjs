import { resultStatus } from "./context.mjs";

export function parseQoder(row, ctx) {
  if (row.sessionId) ctx.sessionId = row.sessionId;
  if (row.cwd) ctx.project = row.cwd;
  if (["workspace-directories", "runtime-config"].includes(row.type)) ctx.recognized++;
  if (!["user", "assistant"].includes(row.type) || !row.message) return;
  ctx.recognized++;
  const content = row.message.content;
  const parts = Array.isArray(content) ? content : [];
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
