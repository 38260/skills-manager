import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const here = path.dirname(fileURLToPath(import.meta.url));
const expected = JSON.parse(fs.readFileSync(path.join(here, "expected-workbuddy.json"), "utf8"));
const expectedIds = new Set(expected.map(row => row.id));
const dbPath = path.join(os.homedir(), ".skills-manager-activity", "usage.db");
const db = new DatabaseSync(dbPath, { timeout: 5000 });
const rows = () => db.prepare("SELECT * FROM events WHERE tool='workbuddy'").all();
const summarize = list => list.reduce((counts, row) => {
  const key = `${row.kind}/${row.trigger}/${row.status}`;
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {});

const before = rows();
const stale = before.filter(row => !expectedIds.has(row.id));
if (stale.some(row => row.kind !== "request")) {
  throw new Error(`发现非请求类型的陈旧记录，停止删除：${JSON.stringify(stale.filter(row => row.kind !== "request"))}`);
}
db.exec("BEGIN IMMEDIATE");
try {
  const remove = db.prepare("DELETE FROM events WHERE id=? AND tool='workbuddy' AND kind='request'");
  let removed = 0;
  for (const row of stale) removed += remove.run(row.id).changes;
  db.exec("COMMIT");
  const after = rows();
  const expectedCounts = summarize(expected);
  const actualCounts = summarize(after);
  const report = {
    generatedAt: new Date().toISOString(),
    expectedTotal: expected.length,
    beforeTotal: before.length,
    removed,
    afterTotal: after.length,
    stale: stale.map(row => ({ id: row.id, kind: row.kind, trigger: row.trigger, status: row.status, skillName: row.skillName, sessionId: row.sessionId, sourceLine: row.sourceLine, sourcePath: row.sourcePath })),
    expectedCounts,
    actualCounts,
    matches: after.length === expected.length
      && Object.keys({ ...expectedCounts, ...actualCounts }).every(key => (expectedCounts[key] || 0) === (actualCounts[key] || 0)),
  };
  fs.writeFileSync(path.join(here, "repair-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}
