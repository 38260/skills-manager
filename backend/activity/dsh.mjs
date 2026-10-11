import { object, resultStatus } from "./context.mjs";

export function parseDsh(row, ctx) {
  if (row.type === "session") {
    if (![1, 2, 3, 4].includes(row.version)) throw new Error("暂不支持此 DSH 日志版本");
    ctx.recognized++; ctx.sessionId = row.id || ctx.sessionId; ctx.project = row.cwd || null;
    return;
  }
  const data = object(row.data);
  if (typeof row.type !== "string" || !row.type.includes("/")) return;
  ctx.recognized++;
  if (row.type === "user/message" && data.source?.kind === "user") {
    ctx.user(data.content, { ...row, id: data.id });
  }
  if (row.type === "tool/call" && data.name === "skill") {
    const args = object(data.arguments);
    ctx.call({ id: data.callId, name: args.name, row });
  }
  if (row.type === "tool/result") {
    const message = data.message;
    if (message?.toolCallId) ctx.result(message.toolCallId, resultStatus(message));
  }
}
