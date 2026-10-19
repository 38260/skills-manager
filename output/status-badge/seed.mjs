// 仅创建本任务的隔离验收数据，不读取或修改用户技能库。
import fs from "node:fs";
import path from "node:path";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";

const root = path.resolve("output/status-badge/data");
if (fs.existsSync(root)) throw new Error("隔离数据目录已存在，请保留现有数据并另选目录");
const home = path.join(root, "home");
for (const name of [".cursor", ".claude", ".omp/agent", ".codex", ".grok", ".config/opencode", ".gemini/antigravity", ".amp"]) fs.mkdirSync(path.join(home, name), { recursive: true });
const store = new Store({ directory: path.join(home, ".skills-manager"), home });
store.setSetting("backup_auto_enabled", "off");
store.setSetting("backup_first_run_prompt", "fresh");
store.setSetting("sync_mode", "copy");
const presetId = store.presets()[0].id;
store.run("UPDATE scenarios SET name=? WHERE id=?", "很长的预设名称用于验证省略文字和行高", presetId);
const library = new Library(store);
for (const [name, status] of [["badge-error", "error"], ["badge-ok", "up_to_date"], ["badge-missing", "source_missing"], ["badge-conflict-error", "error"], ["badge-long-name-for-layout-check", "error"]]) {
  const dir = path.join(root, "upstream", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: 用于测试列表徽章、长来源名称和文字间距。\nmetadata:\n  author: 很长的作者名称\n---\n\n# ${name}\n`);
  const skill = await library.installLocal(dir);
  store.setTags(skill.id, ["长标签用于验证列宽", "性能优化"]);
  store.addSkillToPreset(skill.id, presetId);
  store.run("UPDATE skills SET update_status=?,last_checked_at=? WHERE id=?", status, Date.now(), skill.id);
  if (name.includes("conflict")) store.run("INSERT INTO pending_conflicts VALUES(?,?,?,?)", skill.id, "fixture", dir, Date.now());
}
store.close();
console.log(JSON.stringify({ home, directory: path.join(home, ".skills-manager") }));
