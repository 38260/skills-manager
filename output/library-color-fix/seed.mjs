import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";

const home = path.resolve("output/library-color-fix/data/home");
assert.ok(!fs.existsSync(home), "隔离数据已存在，拒绝覆盖");
for (const agent of [".codex", ".workbuddy"]) fs.mkdirSync(path.join(home, agent, "skills"), { recursive: true });
const store = new Store({ directory: path.join(home, ".skills-manager"), home });
const library = new Library(store);
store.setSetting("theme", "light");
store.setSetting("backup_auto_enabled", "off");
store.setSetting("backup_first_run_prompt", "fresh");
store.setSetting("sync_mode", "copy");
const preset = store.presets()[0].id;
for (const [name, description, tag] of [
  ["playwright", "自动化浏览器交互与页面验证，保留真实业务流程。", "开发工具"],
  ["pdf", "阅读文档、提取表格，并验证输出排版。", "文档"],
  ["archify", "把架构与流程绘制为可探索的图示。", "设计"],
  ["craft-prompts", "创建、诊断和优化可复用的提示词。", "开发工具"],
  ["ui-guide", "界面规范与组件状态检查。", "设计"],
]) {
  const source = path.join(home, "upstream", name);
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  author: 示例团队\n---\n# ${name}\n\n示例正文。`);
  const skill = await library.installLocal(source);
  store.setTags(skill.id, [tag]);
  if (name !== "ui-guide") store.addSkillToPreset(skill.id, preset);
  if (name === "playwright") await library.deploy(skill.id, "codex");
}
assert.equal(store.skills().length, 5);
store.close();
console.log("隔离技能库已准备：5 项技能，包含已部署与未部署状态。");
