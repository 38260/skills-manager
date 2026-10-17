import { ParseContext, contentText } from "./context.mjs";
import { parseCodex } from "./codex.mjs";
import { readRecords } from "./readers.mjs";

const fields = "id,tool,skillName,skillPath,timestamp,sessionId,project,callId,kind,trigger,status,evidence,sourcePath,sourceLine";
const candidate = "tool='codex' AND lower(skillName)='this' AND skillPath IS NULL AND kind='request' AND trigger='manual' AND status='pending' AND evidence='user_selection'";

// 只隔离旧版泛指句产生的待确认请求；原始元数据留在同库，真实加载和调用不会进入候选。
export async function repairGenericRequests(store, { cancelled = () => false } = {}) {
  const db = store.db;
  const result = { archived: 0, confirmed: 0, missing: 0 };
  const repairs = [];
  for (const event of db.prepare(`SELECT * FROM events WHERE ${candidate}`).all()) {
    if (cancelled()) return result;
    let reason;
    try {
      for await (const record of readRecords(event.sourcePath, { cancelled })) {
        if (record.line !== Number(event.sourceLine)) continue;
        if (!record.row || record.row.type !== "response_item" || record.row.payload?.type !== "message" || record.row.payload.role !== "user") break;
        const emitted = [];
        const ctx = new ParseContext("codex", event.sourcePath, { put: row => emitted.push(row) });
        parseCodex(record.row, ctx); ctx.finish();
        if (emitted.some(row => row.skillName.toLowerCase() === "this")) break;
        const text = contentText(record.row.payload.content);
        if (/\b(?:use|invoke|call)\s+(?:the\s+)?this\s+skill\b/i.test(text)) reason = "generic_skill_reference";
        break;
      }
    } catch (error) {
      // 来源丢失时无法确认原文：可恢复地隔离，而不是永久删除或伪称已验证。
      if (error.code === "ENOENT") reason = "unverifiable_missing_source";
      else if (error.code === "CANCELLED") return result;
    }
    if (reason) repairs.push({ event, reason });
  }
  if (!repairs.length || cancelled()) return result;
  db.exec(`CREATE TABLE IF NOT EXISTS archived_requests AS SELECT ${fields},'' AS reason,0 AS archivedAt FROM events WHERE 0;
    CREATE UNIQUE INDEX IF NOT EXISTS archived_requests_id ON archived_requests(id);`);
  const archive = db.prepare(`INSERT OR IGNORE INTO archived_requests(${fields},reason,archivedAt)
    SELECT ${fields},?,? FROM events WHERE id=? AND sourcePath=? AND sourceLine=? AND ${candidate}`);
  const remove = db.prepare(`DELETE FROM events WHERE id=? AND sourcePath=? AND sourceLine=? AND ${candidate}
    AND EXISTS(SELECT 1 FROM archived_requests WHERE archived_requests.id=events.id)`);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const { event, reason } of repairs) {
      archive.run(reason, Date.now(), event.id, event.sourcePath, event.sourceLine);
      const changed = Number(remove.run(event.id, event.sourcePath, event.sourceLine).changes);
      result.archived += changed;
      if (reason === "generic_skill_reference") result.confirmed += changed;
      else result.missing += changed;
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return result;
}
