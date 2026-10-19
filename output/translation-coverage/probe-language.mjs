// 只读校验：用后端真实实现（documentLanguage）跑一遍本机 56 个技能，与人工分类对齐
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { documentLanguage } from "../../backend/skill-translations.mjs";

const HOME = "C:/Users/luckyzyb/.skills-manager";
const db = new DatabaseSync(path.join(HOME, "skills-manager.db"), { readOnly: true });
const rows = db.prepare("SELECT id, name, central_path FROM skills ORDER BY name").all();

const groups = { en: [], zh: [], unknown: [] };
const t0 = Date.now();
let bytes = 0;
for (const row of rows) {
  const file = ["SKILL.md", "skill.md"].map(n => path.join(row.central_path, n)).find(p => fs.existsSync(p));
  if (!file) { groups.unknown.push(row.name); continue; }
  const content = fs.readFileSync(file, "utf8");
  bytes += content.length;
  const { language, ratio } = documentLanguage(content);
  groups[language].push({ name: row.name, ratio });
}
const elapsed = Date.now() - t0;

console.log("技能:", rows.length, "| en:", groups.en.length, "zh:", groups.zh.length, "unknown:", groups.unknown.length);
console.log("读取 + 判定耗时:", elapsed, "ms，总字符:", bytes);
console.log("\nen 组（应全部 <= 0.2）:");
for (const item of groups.en) console.log(`  ${item.ratio.toFixed(3)}  ${item.name}`);
console.log("\nzh 组里比值最低的 5 个（离阈值最近）:");
for (const item of [...groups.zh].sort((a, b) => a.ratio - b.ratio).slice(0, 5)) console.log(`  ${item.ratio.toFixed(3)}  ${item.name}`);
if (groups.unknown.length) console.log("\nunknown:", groups.unknown);
