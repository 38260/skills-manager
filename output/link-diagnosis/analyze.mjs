// 只读诊断：为什么有些调用记录没有技能超链接（managedSkillId / usageSkillId 均为 null）。
// 全程只读用户真实库：activity 库 + skills 库都按 readOnly 打开，不写任何数据。
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { matchManagedSkill, matchUsageSkill } from "../../backend/activity/service.mjs";

const home = os.homedir();
const activityDb = new DatabaseSync(path.join(home, ".skills-manager-activity", "usage.db"), { readOnly: true });
const storeDb = new DatabaseSync(path.join(home, ".skills-manager", "skills-manager.db"), { readOnly: true });

// —— 复刻 store.skills() / store.tools() 的字段形状 ——
const targetRows = storeDb.prepare("SELECT skill_id, tool, target_path FROM skill_targets").all();
const skills = storeDb.prepare("SELECT id, name, alias, central_path FROM skills").all().map(row => ({
  id: row.id,
  name: row.name,
  display_name: row.alias || row.name,
  central_path: row.central_path,
  targets: targetRows.filter(t => t.skill_id === row.id).map(t => ({ tool: t.tool, target_path: t.target_path })),
}));
// tools 只需要 key / skills_dir；判空即可（本诊断主要看 skillPath 精确匹配这一支）。
const tools = [];

const events = activityDb.prepare("SELECT id, tool, skillName, skillPath, project, kind, evidence FROM events").all();
const rows = events.map(event => ({
  ...event,
  strict: matchManagedSkill(event, skills, tools),
  loose: matchUsageSkill(event, skills, tools),
}));

const unlinked = rows.filter(r => !r.loose);
const byName = new Map();
for (const row of rows) {
  const key = `${row.skillName}`;
  const entry = byName.get(key) ?? { skillName: key, total: 0, linked: 0, paths: new Set(), tools: new Set(), kinds: new Set() };
  entry.total += 1;
  if (row.loose) entry.linked += 1;
  entry.paths.add(row.skillPath || "(空)");
  entry.tools.add(row.tool);
  entry.kinds.add(row.kind);
  byName.set(key, entry);
}

// 技能名在库里是否唯一、是否存在
const nameIndex = new Map();
for (const skill of skills) {
  for (const alias of new Set([skill.name, skill.display_name, path.basename(skill.central_path)])) {
    nameIndex.set(alias, (nameIndex.get(alias) ?? 0) + 1);
  }
}

const diagnose = row => {
  if (!row.skillName) return "记录里没有技能名";
  const hits = nameIndex.get(row.skillName) ?? 0;
  if (hits === 0) return "该技能不在 Skills Manager 技能库里（名称查无此技能）";
  if (hits > 1) return `技能库里有 ${hits} 个同名技能，无法唯一定位`;
  return "技能在库里，但日志里的技能路径对不上它的中央库/部署位置";
};

const summary = unlinked.map(row => ({
  skillName: row.skillName, tool: row.tool, kind: row.kind, evidence: row.evidence,
  skillPath: row.skillPath, project: row.project, reason: diagnose(row),
}));
const reasonCount = new Map();
for (const item of summary) reasonCount.set(item.reason, (reasonCount.get(item.reason) ?? 0) + 1);

const report = {
  at: new Date().toISOString(),
  total: rows.length,
  linked: rows.length - unlinked.length,
  unlinked: unlinked.length,
  strictLinked: rows.filter(r => r.strict).length,
  nameOnlyLinked: rows.filter(r => !r.strict && r.loose).length,
  reasons: [...reasonCount].sort((a, b) => b[1] - a[1]),
  skillsInLibrary: skills.length,
  perSkill: [...byName.values()].map(entry => ({
    skillName: entry.skillName, total: entry.total, linked: entry.linked,
    tools: [...entry.tools], kinds: [...entry.kinds],
    inLibrary: (nameIndex.get(entry.skillName) ?? 0),
  })).sort((a, b) => b.total - a.total),
  samples: summary.slice(0, 40),
};
fs.mkdirSync(path.resolve("output/link-diagnosis"), { recursive: true });
fs.writeFileSync(path.resolve("output/link-diagnosis/report.json"), JSON.stringify(report, null, 2));
console.log(`记录 ${report.total} 条：严格关联 ${report.strictLinked}、仅名称关联 ${report.nameOnlyLinked}、无关联 ${report.unlinked}`);
console.log("无关联原因分布：");
for (const [reason, count] of report.reasons) console.log(`  ${count} 条 · ${reason}`);
console.log("\n各技能关联情况：");
for (const item of report.perSkill) console.log(`  ${item.skillName}\t${item.linked}/${item.total}\t库里同名数=${item.inLibrary}\t${item.kinds.join("/")}`);
