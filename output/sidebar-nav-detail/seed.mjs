// 为侧边栏导航验收生成隔离技能库，不接触用户真实数据。
import fs from "node:fs";
import path from "node:path";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";

const root = path.resolve(process.env.SIDEBAR_NAV_DETAIL_DATA);
const home = path.join(root, "home");
const source = path.join(root, "source", "nav-detail-demo");
fs.mkdirSync(path.join(home, ".codex", "skills"), { recursive: true });
fs.mkdirSync(path.join(home, ".qoder", "skills"), { recursive: true });
fs.mkdirSync(source, { recursive: true });
fs.writeFileSync(path.join(source, "SKILL.md"), [
  "---",
  "name: nav-detail-demo",
  "description: 侧边栏导航与技能详情回归验收",
  "---",
  "# nav-detail-demo",
  "",
  "## 概述",
  "",
  "用于验证详情打开时侧边栏仍能关闭浮层并跳转。",
].join("\n"));

const store = new Store({ directory: path.join(home, ".skills-manager"), home });
try {
  store.setSetting("backup_auto_enabled", "off");
  store.setSetting("backup_first_run_prompt", "fresh");
  store.setSetting("sync_mode", "copy");
  store.setSetting("language", "zh");
  store.setSetting("theme", "light");
  const skill = await new Library(store).installLocal(source);
  store.run("INSERT OR IGNORE INTO scenario_skills(scenario_id,skill_id) VALUES(?,?)", store.presets()[0].id, skill.id);
  console.log(JSON.stringify({ directory: store.directory, home, skillId: skill.id }));
} finally {
  store.close();
}
