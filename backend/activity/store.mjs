import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

// WorkBuddy 与 WorkBuddy AI 是两个独立产品，各自维护日志目录，因此作为两个来源分别采集。
export const TOOLS = ["codex", "dsh", "zcode", "qoder", "workbuddy", "workbuddy_ai"];
export const KINDS = ["invocation", "document", "request"];
export const TRIGGERS = ["manual", "automatic", "unknown"];
export const STATUSES = ["pending", "returned", "failed", "unknown"];
export const eventId = (tool, identity, skill) => crypto.createHash("sha256").update(JSON.stringify([tool, identity, skill])).digest("hex");

export function defaultSources(home, env = process.env) {
  return {
    codex: path.join(env.CODEX_HOME || path.join(home, ".codex"), "sessions"),
    dsh: path.join(env.DSH_HOME || path.join(home, ".dsh"), "sessions"),
    zcode: path.join(home, ".zcode", "cli", "db", "db.sqlite"),
    qoder: path.join(home, ".qoder", "projects"),
    workbuddy: path.join(home, ".workbuddy", "projects"),
    // WorkBuddy AI 的会话日志在 ~/.workbuddy-ai/projects（与 .workbuddy 不是同一目录）。
    workbuddy_ai: path.join(env.WORKBUDDY_AI_HOME || path.join(home, ".workbuddy-ai"), "projects"),
  };
}

const columns = ["id", "tool", "skillName", "skillPath", "timestamp", "sessionId", "project", "callId", "kind", "trigger", "status", "evidence", "sourcePath", "sourceLine"];
const text = (value, limit = 4096) => typeof value === "string" ? value.replace(/[\x00-\x1f]/g, "").slice(0, limit) : null;

export class UsageStore {
  constructor(directory) {
    fs.mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(path.join(directory, "usage.db"), { timeout: 5000 });
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, tool TEXT NOT NULL, skillName TEXT NOT NULL, skillPath TEXT,
        timestamp INTEGER, sessionId TEXT, project TEXT, callId TEXT,
        kind TEXT NOT NULL, trigger TEXT NOT NULL, status TEXT NOT NULL,
        evidence TEXT NOT NULL, sourcePath TEXT NOT NULL, sourceLine TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_time ON events(timestamp DESC,id);
      CREATE INDEX IF NOT EXISTS events_tool ON events(tool,timestamp DESC);
      CREATE TABLE IF NOT EXISTS sources (tool TEXT PRIMARY KEY,path TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,
        state TEXT NOT NULL DEFAULT 'idle',lastScan INTEGER,files INTEGER DEFAULT 0,processed INTEGER DEFAULT 0,
        errors INTEGER DEFAULT 0,detail TEXT);
      CREATE TABLE IF NOT EXISTS scanned_files (tool TEXT,path TEXT,fingerprint TEXT,errors INTEGER NOT NULL DEFAULT 0,
        parser_version INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(tool,path));`);
    this.insert = this.db.prepare(`INSERT INTO events(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})
      ON CONFLICT(id) DO UPDATE SET
        status=CASE WHEN excluded.status IN ('returned','failed') OR events.status IN ('pending','unknown') THEN excluded.status ELSE events.status END,
        trigger=CASE WHEN excluded.trigger='manual' OR events.trigger='unknown' THEN excluded.trigger ELSE events.trigger END,
        evidence=CASE WHEN excluded.trigger='manual' OR events.trigger='unknown' THEN excluded.evidence ELSE events.evidence END,
        kind=CASE WHEN excluded.kind='invocation' OR events.kind='request' THEN excluded.kind ELSE events.kind END,
        skillPath=COALESCE(excluded.skillPath,events.skillPath),timestamp=COALESCE(events.timestamp,excluded.timestamp)`);
    // 解析器版本列：解析缺陷修复后让旧的缓存错误计数失效（见 scanner.mjs 的 PARSER_VERSION）。
    const scannedColumns = this.db.prepare("PRAGMA table_info(scanned_files)").all().map(row => row.name);
    if (!scannedColumns.includes("parser_version")) this.db.exec("ALTER TABLE scanned_files ADD COLUMN parser_version INTEGER NOT NULL DEFAULT 0");
  }
  initialize(paths) {
    const insert = this.db.prepare("INSERT OR IGNORE INTO sources(tool,path) VALUES(?,?)");
    for (const tool of TOOLS) insert.run(tool, paths[tool]);
  }
  put(input) {
    if (!TOOLS.includes(input.tool) || !KINDS.includes(input.kind) || !TRIGGERS.includes(input.trigger) || !STATUSES.includes(input.status)) throw new Error("无效的调用记录类型");
    const row = Object.fromEntries(columns.map(key => [key, text(input[key])]));
    row.timestamp = Number.isSafeInteger(input.timestamp) && input.timestamp >= 0 ? input.timestamp : null;
    row.skillName = text(input.skillName, 512);
    if (!row.id || !row.skillName || !row.sourcePath || !row.sourceLine || !row.evidence) throw new Error("调用记录缺少必要字段");
    // 只写入白名单元数据；原始参数、对话和工具输出不会进入历史库。
    this.insert.run(...columns.map(key => row[key]));
  }
  sources() { return this.db.prepare("SELECT * FROM sources ORDER BY rowid").all().map(row => ({ ...row, enabled: !!row.enabled })); }
  removeRequest(id) { this.db.prepare("DELETE FROM events WHERE id=? AND kind='request'").run(id); }
  configure(tool, filename, enabled) {
    if (!TOOLS.includes(tool) || typeof filename !== "string" || !path.isAbsolute(filename) || filename.includes("\0") || filename.length > 4096 || typeof enabled !== "boolean") throw new Error("请选择有效的工具与绝对日志路径");
    this.db.prepare("UPDATE sources SET path=?,enabled=?,state='idle',detail=NULL WHERE tool=?").run(path.normalize(filename), Number(enabled), tool);
  }
  progress(tool, state, values = {}) {
    this.db.prepare("UPDATE sources SET state=?,lastScan=COALESCE(?,lastScan),files=?,processed=?,errors=?,detail=? WHERE tool=?")
      .run(state, values.lastScan ?? null, values.files ?? 0, values.processed ?? 0, values.errors ?? 0, values.detail ?? null, tool);
  }
  query(filter = {}) {
    const where = [], args = [];
    for (const [key, choices] of [["tool", TOOLS], ["kind", KINDS], ["trigger", TRIGGERS], ["status", STATUSES]]) {
      if (filter[key]) {
        if (!choices.includes(filter[key])) throw new Error("无效的筛选条件");
        where.push(`${key}=?`); args.push(filter[key]);
      }
    }
    for (const key of ["skillName", "project"]) if (filter[key]) {
      if (typeof filter[key] !== "string" || filter[key].length > 512) throw new Error("筛选文本过长");
      where.push(`${key} LIKE ? ESCAPE '\\'`); args.push(`%${filter[key].replace(/[\\%_]/g, "\\$&")}%`);
    }
    for (const [key, op] of [["from", ">="], ["to", "<"]]) if (filter[key] != null) {
      if (!Number.isSafeInteger(filter[key]) || filter[key] < 0) throw new Error("无效的筛选时间");
      where.push(`timestamp ${op} ?`); args.push(filter[key]);
    }
    const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const total = this.db.prepare(`SELECT COUNT(*) AS n FROM events${clause}`).get(...args).n;
    const pageSize = Math.min(100, Math.max(1, Number.isSafeInteger(filter.pageSize) ? filter.pageSize : 50));
    const page = Math.min(Math.max(1, Math.ceil(total / pageSize)), Math.max(1, Number.isSafeInteger(filter.page) ? filter.page : 1));
    const items = this.db.prepare(`SELECT * FROM events${clause} ORDER BY timestamp DESC,id LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize);
    const counts = { invocation: 0, document: 0, request: 0, manual: 0, automatic: 0, unknown: 0 };
    for (const row of this.db.prepare(`SELECT kind,trigger,COUNT(*) AS n FROM events${clause} GROUP BY kind,trigger`).all(...args)) {
      counts[row.kind] += row.n;
      if (row.kind !== "request") counts[row.trigger] += row.n;
    }
    return { items, total, page, pageSize, counts };
  }
  close() { this.db.close(); }
}
