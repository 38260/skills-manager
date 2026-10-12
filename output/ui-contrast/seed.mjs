// 为「技能库观感偏灰」诊断准备隔离数据：6 个技能（中英混排、含标签/作者/别名/更新态），
// 让列表页接近真实密度。只写入 output/ui-contrast/data，不接触用户真实技能库。
import fs from "node:fs";
import path from "node:path";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";

const root = path.resolve("output/ui-contrast/data");
fs.rmSync(root, { recursive: true, force: true });
const home = path.join(root, "home");
fs.mkdirSync(home, { recursive: true });

const store = new Store({ directory: path.join(home, ".skills-manager"), home });
store.setSetting("backup_auto_enabled", "off");
store.setSetting("backup_first_run_prompt", "fresh");
store.setSetting("sync_mode", "copy");

const SKILLS = [
  {
    name: "animation-vocabulary",
    tags: ["animation", "glossary"],
    doc: `---\nname: animation-vocabulary\ndescription: Reverse-lookup glossary that turns a vague description of a web animation or motion effect into its exact term.\nmetadata:\n  author: Emil Kowalski\n---\n\n# Animation Vocabulary\n\nTurn a vague description of a motion effect into the precise term, so you know exactly what to ask for. The glossary below is the authoritative vocabulary; quote it verbatim when a term matches.\n\n## Quick Start\n\nThe user describes an effect loosely. You return the matching term(s) in this format:\n\n\`\`\`\n**Stagger** — Animate several items one after another with a small delay between each, creating a cascade.\n\`\`\`\n\nSkill documents live in \`~/.codex/skills/<name>/SKILL.md\`; Codex and DSH both read \`SKILL.md\`, so re-import after editing.\n\n| Term | Meaning |\n| --- | --- |\n| Pop in | Grows out of the element that triggered it |\n| Rubber-banding | Resistance and snap-back when you drag past a boundary |\n`,
  },
  {
    name: "apple-design",
    tags: ["design", "motion"],
    doc: `---\nname: apple-design\ndescription: Apple 式交互与视觉细节的落地清单，覆盖动态、层级与材质。\nmetadata:\n  author: 设计团队\n---\n\n# Apple Design\n\n## 动态\n\n转场要跟手，动画时长控制在 200–400ms，缓动优先使用 \`cubic-bezier(0.32, 0.72, 0, 1)\`。\n\n## 层级\n\n用阴影和模糊建立层级，而不是用边框。\n`,
  },
  {
    name: "emil-design-eng",
    tags: ["design"],
    doc: `---\nname: emil-design-eng\ndescription: Practical engineering notes for shipping polished interface details at speed.\nmetadata:\n  author: Emil Kowalski\n---\n\n# Design Engineering\n\nShip the detail, not the demo. Small, considered states beat a large feature nobody notices.\n\n## Notes\n\n1. Prefer \`transition\` over \`animation\` for state changes.\n2. Never animate layout properties when a transform will do.\n`,
  },
  {
    name: "browser-smoke-test",
    tags: ["testing", "browser"],
    doc: `---\nname: browser-smoke-test\ndescription: 用本机 Chrome headless 对单文件 HTML 做无头冒烟测试，收集运行时报错与 DOM 状态。\nmetadata:\n  author: 工具链\n---\n\n# Browser Smoke Test\n\n## 用法\n\n\`\`\`bash\nnode smoke.mjs https://example.com\n\`\`\`\n\n报告包含控制台报错、失败请求与关键 DOM 断言。\n`,
  },
  {
    name: "pyinstaller-desktop-packaging",
    tags: ["packaging", "windows"],
    doc: `---\nname: pyinstaller-desktop-packaging\ndescription: Package a FastAPI/Flask app into a Windows desktop exe with PyInstaller onedir plus a pywebview window.\nmetadata:\n  author: 工具链\n---\n\n# PyInstaller Desktop Packaging\n\n## Steps\n\n1. Freeze the backend entry point.\n2. Mount the static build as \`--add-data\`.\n3. Wrap the local server in a pywebview window.\n`,
  },
  {
    name: "aihot",
    tags: ["news"],
    doc: `---\nname: aihot\ndescription: 查询 AI HOT 的中文 AI 资讯、精选与日报。\nmetadata:\n  author: 资讯\n---\n\n# AI HOT\n\n按重要性排序输出当日 AI 资讯，附来源链接。\n`,
  },
];

const upstream = path.join(root, "upstream");
const library = new Library(store);
const presetId = store.activeScenarioId() ?? store.presets()[0].id;
for (const item of SKILLS) {
  const skillPath = path.join(upstream, item.name);
  fs.mkdirSync(skillPath, { recursive: true });
  fs.writeFileSync(path.join(skillPath, "SKILL.md"), item.doc);
  const skill = await library.installLocal(skillPath);
  store.setTags(skill.id, item.tags);
  store.addSkillToPreset(skill.id, presetId);
  store.scenarioSkillTools(presetId, skill.id);
}
// 一个从未使用过、也没有作者信息的技能，复现「作者未提供 / 从未使用」这两种最灰的文案
const bare = path.join(upstream, "figma");
fs.mkdirSync(bare, { recursive: true });
fs.writeFileSync(path.join(bare, "SKILL.md"), `---\nname: figma\ndescription: Figma 相关的自动化与规范查询技能。\n---\n\n# Figma\n\n无作者信息的技能，用于复现「作者未提供」文案。\n`);
await library.installLocal(bare);

console.log("skills:", SKILLS.length + 1, "preset:", presetId);
