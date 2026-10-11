import { DatabaseSync } from "node:sqlite";
import { ParseContext, object, resultStatus } from "./context.mjs";

export function readZcode(filename, sink, cancelled = () => false) {
  const db = new DatabaseSync(filename, { readOnly: true, timeout: 3000 });
  let ctx = null, currentMessage = null, userParts = [], userRow = null, count = 0, errors = 0;
  const flushUser = () => {
    if (userRow) ctx.user(userParts, userRow);
    userRow = null; userParts = [];
  };
  try {
    // 读取同一事务快照，SQLite 自行合并已提交 WAL；不复制活跃数据库，也不执行 checkpoint。
    db.exec("PRAGMA query_only=ON; BEGIN;");
    const rows = db.prepare(`SELECT p.id,p.session_id,p.message_id,p.time_created,p.data,
      m.data AS message_data,s.directory
      FROM part p LEFT JOIN message m ON m.id=p.message_id LEFT JOIN session s ON s.id=p.session_id
      ORDER BY p.session_id,p.time_created,p.id`).iterate();
    for (const row of rows) {
      if (cancelled()) throw Object.assign(new Error("扫描已取消"), { code: "CANCELLED" });
      count++;
      if (ctx?.sessionId !== row.session_id) {
        if (ctx) { flushUser(); ctx.finish(); errors += ctx.errors; }
        ctx = new ParseContext("zcode", filename, sink); ctx.sessionId = row.session_id; ctx.project = row.directory;
        currentMessage = null;
      }
      if (currentMessage !== row.message_id) { flushUser(); currentMessage = row.message_id; }
      let part;
      try { part = JSON.parse(row.data); } catch { errors++; continue; }
      const eventRow = { line: `part:${row.id}`, timestamp: part.state?.time?.start ?? row.time_created, id: row.message_id };
      if (object(row.message_data).role === "user" && part.type === "text" && !part.synthetic) {
        userParts.push({ type: "text", text: part.text || "" }); userRow = eventRow;
      }
      if (part.type === "tool" && part.tool === "Skill") {
        flushUser();
        const state = part.state || {};
        const status = ["pending", "running"].includes(state.status) ? "pending" : resultStatus(state);
        ctx.call({ id: part.callID || `part:${row.id}`, name: state.input?.skill, status, row: eventRow });
      }
    }
    if (ctx) { flushUser(); ctx.finish(); errors += ctx.errors; }
    db.exec("COMMIT;");
    return { records: count, errors };
  } finally { db.close(); }
}
