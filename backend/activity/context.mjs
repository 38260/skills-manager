import path from "node:path";
import { eventId } from "./store.mjs";

export const object = value => {
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { return {}; } }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
};
export const contentText = value => typeof value === "string" ? value : Array.isArray(value)
  ? value.filter(item => ["text", "input_text", "output_text"].includes(item?.type)).map(item => item.text || "").join("\n") : "";
export function time(value) {
  const result = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}
export const skillFromPath = filename => filename.replace(/\\/g, "/").split("/").at(-2);
const nameKey = name => String(name).normalize("NFC").toLowerCase();

export class ParseContext {
  constructor(tool, filename, sink) {
    this.tool = tool; this.filename = filename; this.sink = sink;
    this.sessionId = path.basename(filename); this.project = null;
    this.calls = new Map(); this.selections = new Map(); this.autoChoice = false;
    this.recognized = 0; this.errors = 0;
  }
  user(content, row, selections = []) {
    this.flushRequests();
    const text = contentText(content);
    // 只接受明确选择；普通任务描述、系统技能清单和缺失的上文不会推断为自动。
    const explicit = /^\s*\$([\w.:-]+)(?=\s|$)/u.exec(text)
      ?? /^\s*\/skill\s+([\w.:-]+)(?=\s|$)/u.exec(text);
    if (explicit) selections = [...selections, { name: explicit[1] }];
    const command = /<command-name>\/([\w.:-]+)<\/command-name>/u.exec(text);
    if (command) selections = [...selections, { name: command[1], requestable: false }];
    this.autoChoice = /^(?:请)?(?:自行|自动)选择(?:合适的)?技能|^(?:please\s+)?(?:automatically choose|choose appropriate) skills\b/i.test(text.trim());
    for (const selection of selections) if (typeof selection.name === "string" && selection.name.trim()) {
      const name = selection.name.trim();
      const identity = row.id || row.uuid || `${this.sessionId}:${row.timestamp ?? row.time}:${row.line}`;
      const request = this.event({ id: `request:${identity}`, name, skillPath: selection.path, kind: "request", status: "pending", row });
      request.trigger = "manual"; request.evidence = "user_selection";
      this.selections.set(nameKey(name), { request, used: false, requestable: selection.requestable !== false });
    }
  }
  flushRequests() {
    for (const { request, used, requestable } of this.selections.values()) if (!used && requestable) this.sink.put(request);
    this.selections.clear();
  }
  event({ id, name, skillPath, kind = "invocation", status = "pending", row }) {
    const selection = this.selections.get(nameKey(name));
    return {
      id: eventId(this.tool, id || `${this.filename}:${row.line}`, name), tool: this.tool,
      skillName: name, skillPath: skillPath ?? null, timestamp: time(row.timestamp ?? row.time),
      sessionId: this.sessionId, project: this.project, callId: id || null, kind, status,
      trigger: selection ? "manual" : this.autoChoice ? "automatic" : "unknown",
      evidence: selection ? "user_selection" : this.autoChoice ? "user_auto_choice" : kind === "invocation" ? "skill_call" : "document_read",
      sourcePath: this.filename, sourceLine: String(row.line),
    };
  }
  call({ id, name, skillPath, kind, status, row }) {
    if (typeof name !== "string" || !name.trim()) { this.errors++; return; }
    const record = this.event({ id, name: name.trim(), skillPath, kind, status, row });
    const selection = this.selections.get(nameKey(record.skillName));
    if (selection) {
      selection.used = true;
      this.sink.removeRequest?.(selection.request.id);
    }
    const pending = { record, document: kind === "document" };
    if (pending.document && status !== "returned") record.kind = "request";
    if (id) {
      const list = this.calls.get(id) || [];
      list.push(pending); this.calls.set(id, list);
    }
    this.sink.put(record);
  }
  result(id, status) {
    if (!id) return;
    for (const { record, document } of this.calls.get(id) || []) {
      record.status = status;
      if (document && status === "returned") record.kind = "document";
      this.sink.put(record);
    }
    this.calls.delete(id);
  }
  finish() { this.flushRequests(); }
}

export function resultStatus(value) {
  if (value?.isError === true || value?.is_error === true || ["error", "failed", "failure"].includes(value?.status)) return "failed";
  if (["completed", "success", "succeeded", "returned"].includes(value?.status) || value?.isError === false || value?.is_error === false) return "returned";
  return "unknown";
}
