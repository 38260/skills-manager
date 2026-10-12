// 对照验证「触发方式」判定改动：同一批真实日志、两份库副本，分别用改动前（_old/，HEAD 版）
// 与改动后（backend/）的解析器重扫，对比 trigger / evidence 分布。
// 只读用户日志目录，只写临时副本；不打印任何日志内容，只打印计数。
// 用法：node output/activity-fix/compare-trigger.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REAL_DIR = path.join(os.homedir(), ".skills-manager-activity");

function copyStore(tag) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `activity-${tag}-`));
  const copy = path.join(home, ".skills-manager-activity");
  fs.mkdirSync(copy, { recursive: true });
  for (const name of fs.readdirSync(REAL_DIR)) fs.copyFileSync(path.join(REAL_DIR, name), path.join(copy, name));
  return { home, copy };
}

async function run(old) {
  const mod = old ? "./_old" : "../../backend/activity";
  const { UsageStore } = await import(`${mod}/store.mjs`);
  const { scanSources } = await import(`${mod}/scanner.mjs`);
  const { home, copy } = copyStore(old ? "old" : "new");
  const store = new UsageStore(copy);
  // 关键：events 表的 UPSERT 是「只升级不降级」（trigger 仅在 excluded='manual' 或 events='unknown'
  // 时才被覆盖），所以拿一份已被新版解析器写过的库当起点，旧解析器的 unknown 是写不进去的。
  // 要公平对照，两边都必须从**空表**重扫同一批日志。
  store.db.exec("DELETE FROM events; DELETE FROM scanned_files;");
  const started = Date.now();
  const summary = await scanSources(store, { cancelled: () => false, progress: () => {} });
  const rows = store.db.prepare("SELECT trigger, evidence, COUNT(*) n FROM events GROUP BY trigger, evidence ORDER BY n DESC").all();
  const total = store.db.prepare("SELECT COUNT(*) n FROM events").get().n;
  store.close();
  fs.rmSync(home, { recursive: true, force: true });
  return { rows, total, summary, seconds: Math.round((Date.now() - started) / 1000) };
}

function table(title, r) {
  console.log(`\n=== ${title} ===`);
  console.log(`重扫 ${r.seconds}s，共 ${r.total} 条`);
  for (const row of r.rows) console.log(`  ${String(row.trigger).padEnd(10)} ${String(row.evidence).padEnd(16)} ${row.n}`);
}

table("改动前（HEAD 版解析器）", await run(true));
table("改动后（当前解析器）", await run(false));
console.log("\n（用户真实库与日志均未被写入）");
