// 重放全部 Qoder 会话日志，与真实活动库对账：找出修复后不再产生的陈旧记录。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ParseContext } from "../../backend/activity/context.mjs";
import { readRecords } from "../../backend/activity/readers.mjs";
import { parseQoder } from "../../backend/activity/qoder.mjs";

const root = path.join(os.homedir(), ".qoder", "projects");
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
const sink = { put: row => expected.set(row.id, { ...row }), removeRequest: id => expected.delete(id) };
let parseErrors = 0, compactSummaries = 0;
for (const filename of files) {
  const ctx = new ParseContext("qoder", filename, sink);
  for await (const record of readRecords(filename, { compressed: filename.endsWith(".zstd") })) {
    if (record.error) { parseErrors++; continue; }
    if (record.row?.isCompactSummary === true) compactSummaries++;
    parseQoder(record.row, ctx);
  }
  ctx.finish();
  parseErrors += ctx.errors;
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const actual = new Map(db.prepare("SELECT * FROM events WHERE tool='qoder'").all().map(row => [row.id, row]));
db.close();

const summarize = rows => rows.reduce((counts, row) => {
  const key = `${row.kind}/${row.trigger}/${row.status}`;
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {});
const brief = row => ({ kind: row.kind, trigger: row.trigger, status: row.status, skillName: row.skillName, sessionId: row.sessionId, sourceLine: row.sourceLine, id: row.id });
const stale = [...actual.values()].filter(row => !expected.has(row.id));
const missing = [...expected.values()].filter(row => !actual.has(row.id));

// --repair：只删重放后不再产生、且确实是待确认请求的陈旧行；任何调用/文档记录都不许动。
if (process.argv.includes("--repair")) {
  const unsafe = stale.filter(row => row.kind !== "request");
  if (unsafe.length) throw new Error(`存在非请求类的陈旧记录，拒绝清理：${JSON.stringify(unsafe.map(brief))}`);
  if (missing.length) throw new Error(`重放结果缺少 ${missing.length} 条记录，先确认解析器已生效再清理`);
  const writable = new DatabaseSync(dbPath);
  writable.exec("BEGIN IMMEDIATE");
  for (const row of stale) writable.prepare("DELETE FROM events WHERE id=? AND kind='request'").run(row.id);
  writable.exec("COMMIT");
  const after = new Map(writable.prepare("SELECT * FROM events WHERE tool='qoder'").all().map(row => [row.id, row]));
  writable.close();
  console.log(JSON.stringify({ repaired: true, removed: stale.length, remaining: after.size, matchesReplay: after.size === expected.size }, null, 2));
} else {
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    files: files.length,
    parseErrors,
    compactSummaryRows: compactSummaries,
    expectedTotal: expected.size,
    actualTotal: actual.size,
    expectedCounts: summarize([...expected.values()]),
    actualCounts: summarize([...actual.values()]),
    stale: stale.map(brief),
    missing: missing.map(brief),
  }, null, 2));
}
