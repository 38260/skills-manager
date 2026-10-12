// 验证「触发方式」判定改动：在**调用记录库的副本**上重扫真实日志（只读日志、只写副本），
// 对比改动前后的 trigger / evidence 分布。不打印任何日志内容，只打印计数。
// 用法：node output/activity-fix/verify-trigger.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UsageStore } from "../../backend/activity/store.mjs";
import { scanSources } from "../../backend/activity/scanner.mjs";

const REAL_DIR = path.join(os.homedir(), ".skills-manager-activity");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "activity-verify-"));
const copy = path.join(home, ".skills-manager-activity");
fs.mkdirSync(copy, { recursive: true });
for (const name of fs.readdirSync(REAL_DIR)) fs.copyFileSync(path.join(REAL_DIR, name), path.join(copy, name));

const store = new UsageStore(copy);
const before = store.db.prepare("SELECT trigger, COUNT(*) n FROM events GROUP BY trigger").all();
console.log("=== 重扫前（旧解析器结果）===");
console.log(before.map(r => `${r.trigger}: ${r.n}`).join("   "));
console.log(`合计 ${store.db.prepare("SELECT COUNT(*) n FROM events").get().n} 条`);

const started = Date.now();
const summary = await scanSources(store, { cancelled: () => false, progress: () => {} });
console.log(`\n=== 重扫完成 ${Math.round((Date.now() - started) / 1000)}s ===`);
console.log(JSON.stringify(summary));

console.log("\n=== 重扫后 trigger ===");
for (const row of store.db.prepare("SELECT trigger, COUNT(*) n FROM events GROUP BY trigger ORDER BY n DESC").all()) {
  console.log(`  ${row.trigger.padEnd(10)} ${row.n}`);
}
console.log("\n=== 重扫后 evidence ===");
for (const row of store.db.prepare("SELECT evidence, COUNT(*) n FROM events GROUP BY evidence ORDER BY n DESC").all()) {
  console.log(`  ${row.evidence.padEnd(18)} ${row.n}`);
}
console.log("\n=== 按来源看触发方式 ===");
for (const row of store.db.prepare("SELECT tool, trigger, COUNT(*) n FROM events GROUP BY tool, trigger ORDER BY tool, n DESC").all()) {
  console.log(`  ${row.tool.padEnd(14)} ${row.trigger.padEnd(10)} ${row.n}`);
}
store.close();
console.log(`\n（副本目录：${copy}，用户真实库未被写入）`);
