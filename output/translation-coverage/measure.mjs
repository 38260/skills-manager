// 只读测量：每个技能原文的语言分布 + 是否已有中文译文（不改任何文件）
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const HOME = "C:/Users/luckyzyb/.skills-manager";
const db = new DatabaseSync(path.join(HOME, "skills-manager.db"), { readOnly: true });
const rows = db.prepare("SELECT id, name, central_path FROM skills ORDER BY name").all();
const trDir = path.join(HOME, "skills", ".skills-manager", "translations");

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/g;
const LATIN = /[A-Za-z]/g;

const out = [];
for (const row of rows) {
  let body = "";
  try {
    const file = ["SKILL.md", "skill.md"].map(n => path.join(row.central_path, n)).find(p => fs.existsSync(p));
    body = file ? fs.readFileSync(file, "utf8") : "";
  } catch { body = ""; }
  // 去掉 frontmatter，只看正文，避免 description 里的中文影响判断
  const text = body.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---/, "");
  const cjk = (text.match(CJK) || []).length;
  const latin = (text.match(LATIN) || []).length;
  const ratio = cjk + latin === 0 ? 0 : cjk / (cjk + latin);
  const tr = path.join(trDir, `${row.id}.zh-CN.json`);
  let translated = false, stale = false;
  if (fs.existsSync(tr)) {
    translated = true;
    try {
      const saved = JSON.parse(fs.readFileSync(tr, "utf8"));
      const hash = crypto.createHash("sha256").update(fs.readFileSync(path.join(row.central_path, "SKILL.md"))).digest("hex");
      stale = saved.source_hash !== hash;
    } catch { stale = true; }
  }
  out.push({ name: row.name, cjk, latin, ratio: Math.round(ratio * 1000) / 1000, translated, stale });
}

const buckets = [[0, 0.01], [0.01, 0.05], [0.05, 0.2], [0.2, 0.5], [0.5, 1.01]];
console.log("技能总数:", out.length, " 已有译文:", out.filter(o => o.translated).length);
console.log("\nCJK 占比分布（0=纯英文）:");
for (const [lo, hi] of buckets) {
  const items = out.filter(o => o.ratio >= lo && o.ratio < hi);
  console.log(`  [${lo}, ${hi}) -> ${items.length} 个${items.length && hi <= 0.21 ? "：" + items.map(i => `${i.name}(${i.ratio})`).join(", ") : ""}`);
}
console.log("\n逐条（name | ratio | 译文 | stale）:");
for (const o of out) console.log(`${o.ratio.toFixed(3)}  ${o.translated ? "ZH" : "--"}  ${o.stale ? "STALE" : "     "}  ${o.name}`);
fs.writeFileSync(new URL("./measure.json", import.meta.url), JSON.stringify(out, null, 2));
