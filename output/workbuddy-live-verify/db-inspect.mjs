import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
const dbPath = path.join(os.homedir(), ".skills-manager-activity", "usage.db");
const db = new DatabaseSync(dbPath, { readOnly: true });
const q = (sql, ...args) => db.prepare(sql).all(...args);
console.log(JSON.stringify({
  dbPath,
  totals: q("SELECT tool, kind, trigger, status, COUNT(*) n FROM events GROUP BY tool, kind, trigger, status ORDER BY tool, kind, trigger, status"),
  workbuddy: q("SELECT tool, kind, trigger, status, skillName, skillPath, sessionId, sourceLine, timestamp, id FROM events WHERE tool='workbuddy' ORDER BY timestamp, sessionId, sourceLine"),
  scanned: q("SELECT tool, COUNT(*) files, SUM(parser_version) versions FROM scanned_files GROUP BY tool"),
  parserVersions: q("SELECT tool, parser_version, COUNT(*) n FROM scanned_files GROUP BY tool, parser_version"),
}, null, 2));
db.close();
