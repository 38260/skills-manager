import { object, resultStatus } from "./context.mjs";

export function parseWorkbuddy(row, ctx) {
  if (row.sessionId) ctx.sessionId = row.sessionId;
  if (row.cwd) ctx.project = row.cwd;
  if (row.type === "session-meta") { ctx.recognized++; ctx.project = row.meta?.cwd || ctx.project; }
  if (row.type === "message") {
    ctx.recognized++;
    if (row.role === "user") ctx.user(row.content, row);
  }
  // 同一调用的嵌套 message 表示仅作显示；以顶层 callId 作为唯一来源。
  if (row.type === "function_call") {
    ctx.recognized++;
    if (row.name === "Skill") {
      // Skill 工具的参数键随客户端版本变化：`skill` 为主，历史记录使用 `command`。
      const args = object(row.arguments);
      ctx.call({ id: row.callId, name: args.skill ?? args.command, row });
    }
  }
  if (row.type === "function_call_result") {
    ctx.recognized++;
    ctx.result(row.callId, resultStatus(row) === "failed" ? "failed" : "returned");
  }
}
