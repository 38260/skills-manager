// 只读诊断：用真实技能库跑 matchSkillSearch('git')，看每条命中到底命中了哪个字段。
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
const home = os.homedir();
const db = new DatabaseSync(path.join(home, ".skills-manager", "skills-manager.db"), { readOnly: true });
const rows = db.prepare("SELECT id, name, alias, custom_description, description, central_path FROM skills").all();
const { matchSkillSearch } = await import(pathToFileURL(path.resolve("src/lib/skillSearch.ts")).href);
const hits = rows.map(r => ({ r, m: matchSkillSearch(r, "git") })).filter(x => x.m);
console.log(`库里 ${rows.length} 个技能，搜索 "git" 命中 ${hits.length} 个：`);
for (const { r, m } of hits) {
  const value = String(m.value ?? "");
  const lower = value.toLowerCase();
  const at = lower.indexOf("git");
  console.log(`- ${r.name}  [命中字段: ${m.field}]  位置 ${at}:  …${value.slice(Math.max(0, at - 40), at + 40)}…`);
}
