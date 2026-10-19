// logo 选择与标签匹配验收用的隔离数据。
// 只写入 output/skill-logo-match/data，不接触用户真实技能库。
import fs from "node:fs";
import path from "node:path";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";

const root = path.resolve("output/skill-logo-match/data");
fs.rmSync(root, { recursive: true, force: true });
const home = path.join(root, "home");
fs.mkdirSync(home, { recursive: true });
for (const tool of [".codex", ".claude", ".qoder"]) fs.mkdirSync(path.join(home, tool), { recursive: true });

const store = new Store({ directory: path.join(home, ".skills-manager"), home });
store.setSetting("backup_auto_enabled", "off");
store.setSetting("backup_first_run_prompt", "fresh");
store.setSetting("sync_mode", "copy");

const SKILLS = [
  ["doc-reader", "阅读 PDF 与长文档，抽取正文。", ["文档"]],
  ["design-taste", "界面设计与视觉层级评审。", ["设计"]],
  ["perf-budget", "前端性能优化与体积控制。", ["性能优化"]],
  ["untitled-helper", "—", []],
  ["preset-star", "已手动指定 logo 的技能。", []],
];

const upstream = path.join(root, "upstream");
const library = new Library(store);
const presetId = store.activeScenarioId() ?? store.presets()[0].id;
const installed = [];
for (const [name, description, tags] of SKILLS) {
  const dir = path.join(upstream, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  author: 验收团队\n---\n\n# ${name}\n\n${description}\n`);
  const skill = await library.installLocal(dir);
  store.setTags(skill.id, tags);
  store.addSkillToPreset(skill.id, presetId);
  installed.push({ name, id: skill.id, tags });
}

// 一个已经手动指定 logo 的技能：卡片应显示所选图标，而不是按说明匹配出来的图标。
const star = installed.find(item => item.name === "preset-star");
store.setProfile(star.id, { alias: "", customDescription: "", authorOverride: "", icon: "star" });

const rows = store.skills().map(skill => ({ name: skill.name, icon: skill.icon, tags: skill.tags }));
fs.writeFileSync(path.join(root, "fixture.json"), JSON.stringify({ home, skills: rows }, null, 2));
console.log(JSON.stringify({ home, skills: rows }));
