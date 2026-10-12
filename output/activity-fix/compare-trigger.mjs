// 对照验证「触发方式」判定改动：同一批真实日志、两份库副本，分别用改动前与改动后的解析器
// 重扫，对比 trigger / evidence 分布。
// 只读用户日志目录，只写临时副本；不打印任何日志内容，只打印计数。
// 用法：node output/activity-fix/compare-trigger.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// 基线取「本次改动那个提交的父提交」，**不能写 HEAD** —— 改动一旦提交，HEAD 就变成「改动后」，
// 再跑只会得到「新旧一样」的假对照（这正是第一版踩过的坑）。
const BASELINE = "607cff9";
const OLD_DIR = path.join(import.meta.dirname, "_old");
const ROOT = path.join(import.meta.dirname, "..", "..");

/** 把改动前的解析器从基线提交导出到 _old/（该目录在 .gitignore 里，不入库）。 */
function prepareOld() {
  // 已经备好就复用：这个沙箱里 Node spawn git 会偶发 EBUSY，能少调一次就少一次。
  if (fs.existsSync(path.join(OLD_DIR, "context.mjs"))) return;
  fs.mkdirSync(OLD_DIR, { recursive: true });
  const source = path.join(ROOT, "backend", "activity");
  for (const name of fs.readdirSync(source)) {
    if (name.endsWith(".mjs")) fs.copyFileSync(path.join(source, name), path.join(OLD_DIR, name));
  }
  for (const name of ["context.mjs", "scanner.mjs"]) {
    try {
      fs.writeFileSync(path.join(OLD_DIR, name), execFileSync("git", ["show", `${BASELINE}:backend/activity/${name}`], { cwd: ROOT, encoding: "utf8" }));
    } catch (error) {
      console.error(`从基线 ${BASELINE} 导出 ${name} 失败（${error.code ?? error.message}）。\n` +
        `本沙箱里 Node spawn git 会偶发 EBUSY，可先在 shell 里跑：\n` +
        `  git show ${BASELINE}:backend/activity/${name} > output/activity-fix/_old/${name}\n再重跑本脚本。`);
      process.exit(2);
    }
  }
}
prepareOld();

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

table(`改动前（基线 ${BASELINE} 的解析器）`, await run(true));
table("改动后（当前解析器）", await run(false));
console.log("\n（用户真实库与日志均未被写入）");
