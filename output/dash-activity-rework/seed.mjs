// Dashboard / 调用记录重构验收用的隔离数据。
// 覆盖：多 Agent 检测、已部署技能（部署覆盖非零）、带真实差异的项目（同步提醒）、60+ 条调用记录。
// 只写入 output/dash-activity-rework/data，不接触用户真实技能库与日志。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";
import { UsageStore } from "../../backend/activity/store.mjs";

const root = path.resolve("output/dash-activity-rework/data");
fs.rmSync(root, { recursive: true, force: true });
const home = path.join(root, "home");
fs.mkdirSync(home, { recursive: true });

// 让若干 Agent 被检测到（已安装且已启用），Dashboard 才能给出真实数量。
for (const tool of [".codex", ".claude", ".qoder", ".zcode", ".dsh", ".workbuddy"]) {
  fs.mkdirSync(path.join(home, tool), { recursive: true });
}

const store = new Store({ directory: path.join(home, ".skills-manager"), home });
store.setSetting("backup_auto_enabled", "off");
store.setSetting("backup_first_run_prompt", "fresh");
store.setSetting("sync_mode", "copy");

const SKILLS = [
  ["alpha-layout", "Layout primitives for consistent spacing and rhythm.", ["design", "layout"]],
  ["beta-review", "Review checklist for interface details before shipping.", ["review"]],
  ["gamma-a11y", "Accessibility checks: focus order, contrast, labels.", ["a11y", "review"]],
  ["delta-motion", "Motion timing and easing guidance for UI transitions.", ["design"]],
  ["epsilon-copy", "Microcopy rules for buttons, empty states and errors.", ["copy"]],
  ["zeta-perf", "Front-end performance budget and measurement steps.", ["perf"]],
];

const upstream = path.join(root, "upstream");
const library = new Library(store);
const presetId = store.activeScenarioId() ?? store.presets()[0].id;
const installed = [];
for (const [name, description, tags] of SKILLS) {
  const dir = path.join(upstream, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  author: 设计团队\n---\n\n# ${name}\n\n${description}\n\n## 用法\n\n在 \`~/.codex/skills/${name}/SKILL.md\` 中查看完整说明。\n`);
  const skill = await library.installLocal(dir);
  store.setTags(skill.id, tags);
  store.addSkillToPreset(skill.id, presetId);
  store.scenarioSkillTools(presetId, skill.id);
  installed.push({ id: skill.id, name, centralPath: skill.central_path });
}
// 一个未打卡片的技能，用于「从未使用」与未标注分类
const bare = path.join(upstream, "eta-plain");
fs.mkdirSync(bare, { recursive: true });
fs.writeFileSync(path.join(bare, "SKILL.md"), "---\nname: eta-plain\ndescription: 未加分类的示例技能。\n---\n\n# eta-plain\n");
await library.installLocal(bare);

// ── 项目工作区：一个同步一致，一个存在真实内容差异（Dashboard 同步提醒） ──
function seedProject(name, folder, { diverge }) {
  const projectPath = path.join(root, folder);
  const skillsDir = path.join(projectPath, ".codex", "skills");
  fs.mkdirSync(skillsDir, { recursive: true });
  const source = installed[0];
  const copy = path.join(skillsDir, source.name);
  fs.cpSync(source.centralPath, copy, { recursive: true });
  if (diverge) {
    const file = path.join(copy, "SKILL.md");
    fs.appendFileSync(file, "\n## 项目内补充\n\n项目副本与技能库主本内容不一致，用于触发同步提醒。\n");
  }
  // 让副本与主本的文件修改时间接近（<1s），差异才会被判为 diverged 而不是某一侧更新。
  const stamp = Date.now() / 1000;
  for (const target of [copy, source.centralPath]) {
    for (const file of walk(target)) fs.utimesSync(file, stamp, stamp);
  }
  const project = store.insertProject({ name, projectPath, workspaceType: "project" });
  return project;
}
function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full); else yield full;
  }
}
seedProject("SkillsManager", "project-clean", { diverge: false });
seedProject("Web Studio", "project-diverged", { diverge: true });

// ── 调用记录：覆盖 6 个来源、三种触发、三种类型、四种结果，共 68 条（可翻页） ──
const usage = new UsageStore(path.join(home, ".skills-manager-activity"));
usage.initialize({ codex: path.join(home, ".codex", "sessions"), dsh: path.join(home, ".dsh", "sessions"), zcode: path.join(home, ".zcode", "sessions"), qoder: path.join(home, ".qoder", "projects"), workbuddy: path.join(home, ".workbuddy", "projects"), workbuddy_ai: path.join(home, ".workbuddy-ai", "projects") });
const tools = ["codex", "dsh", "zcode", "qoder", "workbuddy", "workbuddy_ai"];
const triggers = ["manual", "automatic", "unknown"];
const kinds = ["invocation", "document", "request"];
const statuses = ["returned", "returned", "returned", "failed", "pending", "unknown"];
const projects = ["D:/AIWorkSpace/Codex/SkillManager", "D:/AIWorkSpace/test", null];
const now = Date.now();
let count = 0;
for (let i = 0; i < 68; i++) {
  const tool = tools[i % tools.length];
  const skill = SKILLS[i % SKILLS.length];
  const kind = kinds[i % kinds.length];
  const trigger = triggers[i % triggers.length];
  const status = statuses[i % statuses.length];
  const timestamp = now - i * 37 * 60 * 1000;
  usage.put({
    id: `seed-${i.toString().padStart(3, "0")}`,
    tool,
    skillName: i % 11 === 0 ? `unknown-skill-${i}` : skill[0],
    skillPath: i % 7 === 0 ? null : path.join(home, ".skills-manager", "skills", skill[0], "SKILL.md"),
    timestamp,
    sessionId: `session-demo-${String(i % 9).padStart(2, "0")}`,
    project: projects[i % projects.length],
    callId: `call_${String(100 + i)}`,
    kind,
    trigger,
    status,
    evidence: trigger === "manual" ? "user_selection" : trigger === "automatic" ? "user_auto_choice" : "document_read",
    sourcePath: path.join(home, `.${tool === "dsh" ? "dsh" : tool}`, "sessions", `session-demo-${String(i % 9).padStart(2, "0")}.jsonl`),
    sourceLine: String(100 + i * 3),
  });
  count++;
}
usage.close();
console.log(`seeded: skills=${SKILLS.length + 1} projects=2 activity=${count} preset=${presetId}`);
