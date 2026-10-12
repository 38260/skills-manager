// 逐个反查本机技能库里的技能在 skills.sh 上的上游仓库。
// 只读用户技能库（只读打开）+ 只请求 skills.sh 搜索接口；不写任何用户数据。
// 用法：node output/skill-source/probe-sources.mjs
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { searchSkills } from "../../backend/skillssh.mjs";

const db = new DatabaseSync(path.join(os.homedir(), ".skills-manager", "skills-manager.db"), { readOnly: true });
const skills = db.prepare("SELECT name, source_type, source_ref FROM skills ORDER BY name").all();
db.close();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rows = [];
for (const skill of skills) {
  if (skill.source_type !== "local" && skill.source_type !== "import") {
    rows.push({ name: skill.name, verdict: "已有来源", detail: skill.source_ref });
    continue;
  }
  try {
    const hits = await searchSkills(skill.name, 8);
    const exact = hits.filter(h => h.skill_id.toLowerCase() === skill.name.toLowerCase());
    rows.push({
      name: skill.name,
      verdict: exact.length ? `命中 ${exact.length}` : "无同名",
      detail: exact.slice(0, 3).map(h => `${h.source}/${h.skill_id} (installs ${h.installs})`).join(" ; ") || hits.slice(0, 2).map(h => h.source + "/" + h.skill_id).join(" ; "),
    });
  } catch (error) {
    rows.push({ name: skill.name, verdict: "请求失败", detail: error.message });
  }
  await sleep(150);
}
const w = Math.max(...rows.map(r => r.name.length));
for (const r of rows) console.log(`${r.name.padEnd(w)}  ${r.verdict.padEnd(10)} ${r.detail}`);
console.log(`\n共 ${rows.length} 个技能；命中同名的 ${rows.filter(r => r.verdict.startsWith("命中")).length} 个。`);
