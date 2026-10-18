import fs from "node:fs";
import readline from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { readRecords } from "./readers.mjs";
import { evidenceSummary, summarizeRaw } from "./evidence.mjs";

// 详情里只展示目标行周围的一小段：既能看清触发证据，也不会把整份会话日志读进内存。
const CONTEXT_LINES = 2;
const MAX_LINE_CHARS = 4000;
const MAX_DATABASE_CHARS = 12000;

const clip = (value, limit = MAX_LINE_CHARS) => {
  const text = String(value ?? "");
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

function unavailable(event, reason, extra = {}) {
  return {
    available: false, reason, lines: [], truncated: false,
    sourcePath: event.sourcePath, sourceLine: String(event.sourceLine ?? ""),
    focus: String(event.sourceLine ?? ""), lineKind: "line", ...extra,
  };
}

async function lineWindow(filename, target, event) {
  const start = Math.max(1, target - CONTEXT_LINES), end = target + CONTEXT_LINES;
  const stream = fs.createReadStream(filename, { encoding: "utf8" });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const lines = [];
  let truncated = false;
  try {
    let number = 0;
    for await (const raw of reader) {
      number++;
      if (number < start) continue;
      if (raw.length > MAX_LINE_CHARS) truncated = true;
      lines.push({ label: String(number), text: clip(raw), summary: summarizeRaw(raw, event) });
      if (number >= end) break;
    }
  } finally {
    reader.close();
    stream.destroy();
  }
  return { lines, found: lines.some(line => line.label === String(target)), truncated };
}

async function compressedWindow(filename, target, event) {
  const start = Math.max(1, target - CONTEXT_LINES), end = target + CONTEXT_LINES;
  const lines = [];
  let truncated = false;
  for await (const record of readRecords(filename, { compressed: true })) {
    if (record.line < start) continue;
    // readRecords 会把行号并入 row，展示时去掉，保持原始记录内容。
    const row = { ...(record.row ?? {}) };
    delete row.line;
    const text = record.error ? `[无法解析的日志行：${record.error}]` : JSON.stringify(row);
    if (text.length > MAX_LINE_CHARS) truncated = true;
    lines.push({ label: String(record.line), text: clip(text), summary: record.error ? summarizeRaw(text, event) : evidenceSummary(row, event) });
    if (record.line >= end) break;
  }
  return { lines, found: lines.some(line => line.label === String(target)), truncated };
}

function zcodeWindow(filename, partId, event) {
  const db = new DatabaseSync(filename, { readOnly: true, timeout: 3000 });
  try {
    // 与扫描器一致：只读事务里取快照，活跃数据库的 WAL 由 SQLite 合并。
    db.exec("PRAGMA query_only=ON; BEGIN;");
    const row = db.prepare("SELECT data FROM part WHERE id=?").get(partId);
    db.exec("COMMIT;");
    if (!row) return { lines: [], found: false, truncated: false };
    let text = String(row.data ?? "");
    const summary = summarizeRaw(text, event);
    try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* 非 JSON 的 part 原样展示。 */ }
    return { lines: [{ label: `part:${partId}`, text: clip(text, MAX_DATABASE_CHARS), summary }], found: true, truncated: text.length > MAX_DATABASE_CHARS };
  } finally { db.close(); }
}

/**
 * 读取一条调用记录对应的原始日志片段。
 * 只接收数据库里的来源路径与位置，不把原始内容写入历史库；读取失败时返回结构化原因。
 */
export async function activityExcerpt(event) {
  const sourcePath = typeof event?.sourcePath === "string" ? event.sourcePath : "";
  if (!sourcePath) throw new Error("调用记录缺少来源文件");
  const sourceLine = String(event.sourceLine ?? "");
  const zcode = event.tool === "zcode" || sourceLine.startsWith("part:");
  const sourceKind = zcode ? "zcode" : sourcePath.endsWith(".zstd") ? "zstd" : "jsonl";
  if (!fs.existsSync(sourcePath)) {
    return unavailable(event, "missing", zcode ? { kind: sourceKind, lineKind: "part" } : { kind: sourceKind });
  }

  if (zcode) {
    const partId = sourceLine.slice("part:".length);
    if (!partId) return unavailable(event, "not_found", { kind: "zcode", lineKind: "part" });
    try {
      const window = zcodeWindow(sourcePath, partId, event);
      if (!window.found) return unavailable(event, "not_found", { kind: "zcode", lineKind: "part" });
      return {
        available: true, kind: "zcode", lineKind: "part", sourcePath, sourceLine,
        focus: sourceLine, lines: window.lines, truncated: window.truncated,
      };
    } catch (error) {
      return unavailable(event, "unreadable", { kind: "zcode", lineKind: "part", detail: clip(error.message, 300) });
    }
  }

  const target = Number(sourceLine);
  if (!Number.isSafeInteger(target) || target < 1) return unavailable(event, "not_found", { kind: sourcePath.endsWith(".zstd") ? "zstd" : "jsonl" });
  const compressed = sourcePath.endsWith(".zstd");
  try {
    const window = compressed ? await compressedWindow(sourcePath, target, event) : await lineWindow(sourcePath, target, event);
    const kind = compressed ? "zstd" : "jsonl";
    if (!window.found) return unavailable(event, "not_found", { kind });
    return {
      available: true, kind, lineKind: "line", sourcePath, sourceLine,
      focus: String(target), lines: window.lines, truncated: window.truncated,
    };
  } catch (error) {
    return unavailable(event, "unreadable", { kind: compressed ? "zstd" : "jsonl", detail: clip(error.message, 300) });
  }
}
