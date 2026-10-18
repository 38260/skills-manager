// 全来源重放对账：用当前解析器重算每个来源的记录，与真实活动库逐条比对。
// 目的：确认历史解析缺陷（引用型文本、压缩摘要、菜单注入等）没有留下未被清理的记录。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ParseContext } from "../../backend/activity/context.mjs";
import { readRecords } from "../../backend/activity/readers.mjs";
import { readZcode } from "../../backend/activity/zcode.mjs";
import { parseCodex } from "../../backend/activity/codex.mjs";
import { parseDsh } from "../../backend/activity/dsh.mjs";
import { parseQoder } from "../../backend/activity/qoder.mjs";
import { parseWorkbuddy } from "../../backend/activity/workbuddy.mjs";
import { PARSER_VERSION } from "../../backend/activity/scanner.mjs";

const dbPath = path.join(os.homedir(), ".skills-manager-activity", "usage.db");
const parsers = { codex: parseCodex, dsh: parseDsh, qoder: parseQoder, workbuddy: parseWorkbuddy, workbuddy_ai: parseWorkbuddy };
const nameShape = /^[A-Za-z0-9\u4e00-\u9fff][A-Za-z0-9._:\u4e00-\u9fff-]*$/;

async function discover(source) {
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
    } else if ((source.tool === "dsh" ? /\.jsonl(?:\.zstd)?$/i : /\.jsonl$/i).test(filename)) files.push(filename);
  }
  if (source.tool === "zcode") return [source.path];
  await walk(source.path);
  if (source.tool === "codex" && path.basename(source.path) === "sessions") {
    try { await walk(path.join(path.dirname(source.path), "archived_sessions")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (source.tool === "dsh") {
    const generations = new Map();
    for (const filename of files) {
      const version = Number(/\.v(\d+)\.jsonl/.exec(filename)?.[1] || 0);
      const base = filename.replace(/\.v\d+(?=\.jsonl)/, "");
      if (!generations.has(base) || version > generations.get(base).version) generations.set(base, { filename, version });
    }
    return [...generations.values()].map(item => item.filename).sort();
  }
  return files.sort();
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const sources = db.prepare("SELECT tool, path FROM sources WHERE enabled=1").all();
const report = { generatedAt: new Date().toISOString(), parserVersion: PARSER_VERSION, tools: [], suspiciousNames: [] };

for (const source of sources) {
  const expected = new Map();
  const sink = { put: row => expected.set(row.id, { ...row }), removeRequest: id => expected.delete(id) };
  const files = await discover(source);
  let parseErrors = 0;
  const parse = parsers[source.tool];
  for (const filename of files) {
    if (source.tool === "zcode") { parseErrors += readZcode(filename, sink).errors; continue; }
    const ctx = new ParseContext(source.tool, filename, sink);
    for await (const record of readRecords(filename, { compressed: filename.endsWith(".zstd") })) {
      if (record.error) { parseErrors++; continue; }
      parse(record.row, ctx);
    }
    ctx.finish();
    parseErrors += ctx.errors;
  }

  const actual = new Map(db.prepare("SELECT * FROM events WHERE tool=?").all(source.tool).map(row => [row.id, row]));
  const missingSource = row => { try { return !fs.existsSync(row.sourcePath); } catch { return true; } };
  const stale = [...actual.values()].filter(row => !expected.has(row.id));
  const brief = row => ({ skillName: row.skillName, kind: row.kind, trigger: row.trigger, status: row.status, sessionId: row.sessionId, sourceLine: row.sourceLine, sourceMissing: missingSource(row) });
  const summarize = rows => rows.reduce((counts, row) => {
    const key = `${row.kind}/${row.trigger}/${row.status}`;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});

  for (const row of expected.values()) if (!nameShape.test(row.skillName)) report.suspiciousNames.push({ tool: source.tool, ...brief(row) });
  report.tools.push({
    tool: source.tool, files: files.length, parseErrors,
    expected: expected.size, actual: actual.size,
    expectedCounts: summarize([...expected.values()]), actualCounts: summarize([...actual.values()]),
    stale: stale.map(brief), missing: [...expected.values()].filter(row => !actual.has(row.id)).map(brief),
  });
}
db.close();
console.log(JSON.stringify(report, null, 2));
