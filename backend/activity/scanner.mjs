import fs from "node:fs";
import path from "node:path";
import { ParseContext } from "./context.mjs";
import { readRecords } from "./readers.mjs";
import { parseCodex } from "./codex.mjs";
import { parseDsh } from "./dsh.mjs";
import { parseQoder } from "./qoder.mjs";
import { parseWorkbuddy } from "./workbuddy.mjs";
import { readZcode } from "./zcode.mjs";

const parsers = { codex: parseCodex, dsh: parseDsh, qoder: parseQoder, workbuddy: parseWorkbuddy };
const cancelledError = () => Object.assign(new Error("扫描已取消"), { code: "CANCELLED" });

async function discover(source, cancelled) {
  const files = [], visited = new Set();
  async function walk(filename, depth = 0) {
    if (cancelled()) throw cancelledError();
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
  if (source.tool === "zcode") {
    const stat = await fs.promises.stat(source.path);
    if (!stat.isFile()) throw new Error("ZCode 来源应为数据库文件");
    return [source.path];
  }
  await walk(source.path);
  if (source.tool === "codex" && path.basename(source.path) === "sessions") {
    const archive = path.join(path.dirname(source.path), "archived_sessions");
    try { await walk(archive); } catch (error) { if (error.code !== "ENOENT") throw error; }
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

async function fingerprint(filename, database = false) {
  const parts = [];
  for (const file of database ? [filename, `${filename}-wal`] : [filename]) {
    try { const stat = await fs.promises.stat(file); parts.push([stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino]); }
    catch (error) { if (error.code !== "ENOENT") throw error; parts.push(null); }
  }
  return JSON.stringify(parts);
}

export async function scanSources(store, { cancelled = () => false, progress = () => {} } = {}) {
  const cached = store.db.prepare("SELECT fingerprint,errors FROM scanned_files WHERE tool=? AND path=?");
  const saveFile = store.db.prepare("INSERT INTO scanned_files(tool,path,fingerprint,errors) VALUES(?,?,?,?) ON CONFLICT(tool,path) DO UPDATE SET fingerprint=excluded.fingerprint,errors=excluded.errors");
  const summary = { files: 0, parsed: 0, errors: 0, cancelled: false };
  for (const source of store.sources()) {
    if (cancelled()) { summary.cancelled = true; break; }
    if (!source.enabled) { store.progress(source.tool, "disabled"); continue; }
    let files = [], processed = 0, errors = 0;
    const report = (state, detail = null) => {
      store.progress(source.tool, state, { files: files.length, processed, errors, detail, lastScan: state === "scanning" ? null : Date.now() });
      progress({ tool: source.tool, state, files: files.length, processed, errors });
    };
    report("scanning");
    try {
      files = await discover(source, cancelled); summary.files += files.length; report("scanning");
      for (const filename of files) {
        if (cancelled()) throw cancelledError();
        const before = await fingerprint(filename, source.tool === "zcode");
        const previous = cached.get(source.tool, filename);
        if (previous?.fingerprint === before) { processed++; errors += previous.errors; continue; }
        let fileErrors = 0;
        try {
          if (source.tool === "zcode") fileErrors += readZcode(filename, store, cancelled).errors;
          else {
            const ctx = new ParseContext(source.tool, filename, store);
            try {
              for await (const record of readRecords(filename, { compressed: filename.endsWith(".zstd"), cancelled })) {
                if (record.error) fileErrors++; else parsers[source.tool](record.row, ctx);
              }
            } finally { ctx.finish(); fileErrors += ctx.errors; }
            if (!ctx.recognized) fileErrors++;
          }
        } catch (error) {
          if (error.code === "CANCELLED") throw error;
          fileErrors++;
        }
        summary.parsed++; errors += fileErrors; processed++;
        // 扫描期间变化的文件不记为完成，下次重新读取；已写入事件保持幂等。
        if (before === await fingerprint(filename, source.tool === "zcode")) saveFile.run(source.tool, filename, before, fileErrors);
        report("scanning");
      }
      report(errors ? "partial" : "ready", errors ? "部分记录不完整、格式未知或读取失败，已保留可确认的历史" : null);
    } catch (error) {
      if (error.code === "CANCELLED") { summary.cancelled = true; report("cancelled"); break; }
      errors++;
      report(error.code === "ENOENT" ? "missing" : ["EACCES", "EPERM"].includes(error.code) ? "denied" : "error",
        error.code === "ENOENT" ? "未找到日志来源" : ["EACCES", "EPERM"].includes(error.code) ? "无权读取日志来源" : "无法读取此来源，请检查路径与文件格式");
    }
    summary.errors += errors;
  }
  return summary;
}
