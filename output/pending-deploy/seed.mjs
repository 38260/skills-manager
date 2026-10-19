// 「部署覆盖 → 未部署名单」验收用的隔离数据。
// 目标现场：6 个技能、其中 2 个没有任何部署目标，且其中一个带别名（验证展示名优先）。
// 只写入 output/pending-deploy/data，不接触用户真实技能库。
import fs from "node:fs";
import path from "node:path";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";

// 每轮验收用一个全新的数据目录（由 verify 通过 PENDING_DEPLOY_DATA 指定），
// 因此不需要删除或改名旧目录：本机 Node 的 rmSync 被安全删除垫片接管，
// 删目录会转去回收站并失败，留下半截数据。历次数据放在 data/<run> 下，可手动整体清理。
const root = path.resolve(process.env.PENDING_DEPLOY_DATA ?? path.join("output/pending-deploy/data", `run-${Date.now()}`));
const home = path.join(root, "home");
fs.mkdirSync(home, { recursive: true });

// 让若干 Agent 被检测到（已安装且已启用）。
for (const tool of [".codex", ".claude", ".qoder", ".zcode"]) {
  fs.mkdirSync(path.join(home, tool), { recursive: true });
}

const store = new Store({ directory: path.join(home, ".skills-manager"), home });
store.setSetting("backup_auto_enabled", "off");
store.setSetting("backup_first_run_prompt", "fresh");
store.setSetting("sync_mode", "copy");

const SKILLS = [
  ["alpha-layout", "Layout primitives for consistent spacing and rhythm.", ["design"]],
  ["beta-review", "Review checklist for interface details before shipping.", ["review"]],
  ["gamma-a11y", "Accessibility checks: focus order, contrast, labels.", ["a11y"]],
  ["delta-motion", "Motion timing and easing guidance for UI transitions.", ["design"]],
  // 下面两个保持未部署
  ["epsilon-copy", "Microcopy rules for buttons, empty states and errors.", ["copy"]],
  ["zeta-perf-with-a-deliberately-long-name", "Front-end performance budget and measurement steps.", ["perf"]],
];

const upstream = path.join(root, "upstream");
const library = new Library(store);
const presetId = store.activeScenarioId() ?? store.presets()[0].id;
for (const [name, description, tags] of SKILLS) {
  const dir = path.join(upstream, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  author: 设计团队\n---\n\n# ${name}\n\n${description}\n`
  );
  const skill = await library.installLocal(dir);
  store.setTags(skill.id, tags);
  store.addSkillToPreset(skill.id, presetId);
  store.scenarioSkillTools(presetId, skill.id);
  // 别名用于验证「名单优先展示别名」
  if (name === "epsilon-copy") store.setProfile(skill.id, { alias: "文案规范", customDescription: null, authorOverride: null, icon: null });
}

console.log(`seeded: skills=${SKILLS.length} agents=4 (待部署的 2 个由 verify 脚本保持零部署)`);
