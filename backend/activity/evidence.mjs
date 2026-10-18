import { contentText, object } from "./context.mjs";

const CONTENT_LIMIT = 1800;

// 先解析完整记录，再围绕本技能取窗口，避免原始 JSON 的前置元数据挤掉调用证据。
function preview(text, event) {
  if (text.length <= CONTENT_LIMIT) return { content: text, truncated: false };
  const needles = [event.skillPath, event.skillPath?.replace(/\\/g, "/"), event.skillName].filter(Boolean);
  let index = -1;
  for (const needle of needles) {
    index = text.toLowerCase().indexOf(needle.toLowerCase());
    if (index >= 0) break;
  }
  const start = Math.min(Math.max(0, index - 120), text.length - CONTENT_LIMIT);
  return { content: `${start ? "…" : ""}${text.slice(start, start + CONTENT_LIMIT)}${start + CONTENT_LIMIT < text.length ? "…" : ""}`, truncated: true };
}

function inputContent(input) {
  const args = object(input);
  const command = args.cmd ?? args.command;
  if (typeof command === "string") return { content: command, format: "command" };
  const filename = args.path ?? args.file_path ?? args.file;
  if (typeof filename === "string") return { content: filename, format: "text" };
  if (typeof input === "string" && !Object.keys(args).length) return { content: input, format: "text" };
  return { content: JSON.stringify(args, null, 2), format: "json" };
}

function textContent(value) {
  return contentText(value) || (value === undefined ? "" : JSON.stringify(value, null, 2));
}

/** 仅投影已知日志字段，不执行日志中的脚本，也不推断相邻记录的调用关系。 */
export function evidenceSummary(row, event = {}) {
  let role = "record", toolName = null, callId = null, content = "", format = "text", parsed = true;
  const call = (name, input, id) => {
    role = "call"; toolName = typeof name === "string" ? name : null; callId = typeof id === "string" ? id : null;
    ({ content, format } = inputContent(input));
  };
  const message = (messageRole, body) => { role = messageRole; content = textContent(body); };
  const data = row.payload ?? row.data ?? row;

  if (row.type === "response_item" && ["function_call", "custom_tool_call"].includes(data.type)) {
    call(data.name, data.arguments ?? data.input, data.call_id);
  } else if (row.type === "response_item" && ["function_call_output", "custom_tool_call_output"].includes(data.type)) {
    message("result", data.output); callId = data.call_id || null;
  } else if (row.type === "response_item" && data.type === "message") {
    message(data.role === "user" ? "user" : "assistant", data.content);
  } else if (row.type === "tool/call") {
    call(data.name, data.arguments, data.callId);
  } else if (row.type === "tool/result") {
    message("result", data.message?.content ?? data.message); callId = data.message?.toolCallId || null;
  } else if (row.type === "user/message") {
    message(data.source?.kind === "skill-invocation" ? "call" : "user", data.content);
    toolName = data.source?.kind === "skill-invocation" ? data.source.name : null;
  } else if (["user", "assistant"].includes(row.type) && row.message) {
    const parts = Array.isArray(row.message.content) ? row.message.content : [];
    const part = parts.find(item => ["tool_use", "tool_result"].includes(item.type) && (item.id === event.callId || item.tool_use_id === event.callId))
      ?? parts.find(item => item.type === "tool_use" && (event.skillName ? item.input?.skill === event.skillName : !event.callId));
    if (part?.type === "tool_use") call(part.name, part.input, part.id);
    else if (part?.type === "tool_result") { message("result", part.content); callId = part.tool_use_id || null; }
    else message(row.type, row.message.content);
  } else if (row.type === "function_call") {
    call(row.name, row.arguments, row.callId);
  } else if (row.type === "function_call_result") {
    message("result", row.output ?? row.result ?? row); callId = row.callId || null;
  } else if (row.type === "message") {
    message(row.role === "user" ? "user" : "assistant", row.content);
  } else if (row.type === "tool" && row.tool && row.state) {
    call(row.tool, row.state.input, row.callID);
  } else if (row.type === "text" && typeof row.text === "string") {
    message("record", row.text);
  } else {
    parsed = false; format = "json"; content = JSON.stringify(row, null, 2);
  }
  return { role, toolName, callId, format, parsed, ...preview(content, event) };
}

export function summarizeRaw(raw, event) {
  try { return evidenceSummary(JSON.parse(raw.replace(/^\uFEFF/, "")), event); }
  catch { return { role: "record", toolName: null, callId: null, format: "text", parsed: false, ...preview(raw, event) }; }
}
