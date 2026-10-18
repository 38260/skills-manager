import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ParseContext } from "../../backend/activity/context.mjs";
import { readRecords } from "../../backend/activity/readers.mjs";
import { parseWorkbuddy } from "../../backend/activity/workbuddy.mjs";

const root = path.join(os.homedir(), ".workbuddy", "projects");
const dbPath = path.join(os.homedir(), ".skills-manager-activity", "usage.db");

async function discover(directory) {
  const files = [], visited = new Set();
  async function walk(filename, depth = 0) {
    if (depth > 32 || files.length >= 100000) throw new Error("日志目录超过扫描上限");
    const canonical = await fs.promises.realpath(filename);
    if (visited.has(canonical)) return;
    visited.add(canonical);
    const stat = await fs.promises.stat(filename);
    if (stat.isDirectory()) {
      for (const entry of await fs.promises.readdir(filename, { withFileTypes: true })) {
        if ([".git", "node_modules"].includes(entry.name)) continue;
        await walk(path.join(filename, entry.name), depth + 1);
      }
    } else if (/\.jsonl$/i.test(filename)) files.push(filename);
  }
  await walk(directory);
  return files.sort();
}

const files = await discover(root);
const expected = new Map();
const sink = {
  put: row => expected.set(row.id, { ...row }),
  removeRequest: id => expected.delete(id),
};
let parseErrors = 0;
for (const filename of files) {
  const ctx = new ParseContext("workbuddy", filename, sink);
  for await (const record of readRecords(filename, { cancelled: () => false })) {
    if (record.error) parseErrors++;
    else parseWorkbuddy(record.row, ctx);
  }
  ctx.finish();
  parseErrors += ctx.errors;
  if (!ctx.recognized) parseErrors++;
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const actual = new Map(db.prepare("SELECT * FROM events WHERE tool='workbuddy'").all().map(row => [row.id, row]));
db.close();

const summarize = rows => rows.reduce((counts, row) => {
  const key = `${row.kind}/${row.trigger}/${row.status}`;
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {});
const fields = ["kind", "trigger", "status", "skillName", "skillPath", "evidence", "callId", "sessionId", "project", "sourcePath", "sourceLine", "timestamp"];
const changes = [];
for (const [id, row] of expected) {
  const old = actual.get(id);
  if (!old) continue;
  const diff = Object.fromEntries(fields.filter(key => String(old[key] ?? "") !== String(row[key] ?? "")).map(key => [key, { db: old[key], expected: row[key] }]));
  if (Object.keys(diff).length) changes.push({ id, skillName: row.skillName, sessionId: row.sessionId, sourceLine: row.sourceLine, diff });
}
const stale = [...actual.values()].filter(row => !expected.has(row.id));
const missing = [...expected.values()].filter(row => !actual.has(row.id));
const report = {
  generatedAt: new Date().toISOString(),
  files: files.length,
  parseErrors,
  expectedTotal: expected.size,
  actualTotal: actual.size,
  expectedCounts: summarize([...expected.values()]),
  actualCounts: summarize([...actual.values()]),
  stale: stale.map(row => ({ kind: row.kind, trigger: row.trigger, status: row.status, skillName: row.skillName, sessionId: row.sessionId, sourceLine: row.sourceLine, id: row.id })),
  missing: missing.map(row => ({ kind: row.kind, trigger: row.trigger, status: row.status, skillName: row.skillName, sessionId: row.sessionId, sourceLine: row.sourceLine, id: row.id })),
  changes,
  expectedRequests: [...expected.values()].filter(row => row.kind === "request").map(row => ({ skillName: row.skillName, sessionId: row.sessionId, sourceLine: row.sourceLine, project: row.project })),
};
fs.writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "expected-workbuddy.json"), JSON.stringify([...expected.values()], null, 2));
console.log(JSON.stringify(report, null, 2));
