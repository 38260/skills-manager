// 列宽测量用隔离数据：12 个长短不一的技能 + 40 条调用记录。
// 每轮独立目录，不做删除（本机 rmSync 被安全删除垫片接管）。
import fs from "node:fs";
import path from "node:path";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";
import { UsageStore } from "../../backend/activity/store.mjs";

const root = path.resolve(process.env.COLWIDTH_DATA ?? path.join("output/column-widths/data", `run-${Date.now()}`));
const home = path.join(root, "home");
fs.mkdirSync(home, { recursive: true });

for (const tool of [".codex", ".claude", ".qoder", ".zcode", ".workbuddy", ".workbuddy-ai"]) {
  fs.mkdirSync(path.join(home, tool), { recursive: true });
}

const store = new Store({ directory: path.join(home, ".skills-manager"), home });
store.setSetting("backup_auto_enabled", "off");
store.setSetting("backup_first_run_prompt", "fresh");
store.setSetting("sync_mode", "copy");

const SKILLS = [
  ["alpha-layout", "Layout primitives for consistent spacing and rhythm across product surfaces.", ["design", "layout"]],
  ["beta-review", "Review checklist for interface details before shipping.", ["review"]],
  ["gamma-a11y", "Accessibility checks: focus order, contrast, labels.", ["a11y"]],
  ["delta-motion", "Motion timing and easing guidance for UI transitions.", ["design"]],
  ["epsilon-copy", "Microcopy rules for buttons, empty states and errors.", ["copy"]],
  ["zeta-perf", "Front-end performance budget and measurement steps.", ["perf"]],
  ["eta-analytics", "Event naming and analytics instrumentation conventions.", ["data"]],
  ["theta-testing", "Testing pyramid guidance and fixtures for UI components.", ["test"]],
  ["iota-very-long-skill-name-for-truncation-check", "A deliberately long skill name to verify truncation behaviour.", ["design", "review", "perf"]],
  ["kappa-release", "Release checklist and versioning rules.", ["release"]],
  ["lambda-docs", "Documentation structure and tone of voice.", ["copy", "docs"]],
  ["mu-security", "Security review prompts for generated code.", ["security"]],
];

const upstream = path.join(root, "upstream");
const library = new Library(store);
const presetId = store.activeScenarioId() ?? store.presets()[0].id;
const installed = [];
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
  installed.push({ id: skill.id, name, centralPath: skill.central_path });
}

// 6 个技能部署到 Agent，其余保持未部署（顺便让「部署覆盖」有非零数据）。
const tools = ["codex", "claude_code", "qoder", "zcode"];
for (let index = 0; index < 6; index++) {
  await library.deploy(installed[index].id, tools[index % tools.length]);
}

// 调用记录：覆盖 6 个 Agent、三种触发与三类结果。
const usage = new UsageStore(path.join(home, ".skills-manager-activity"));
usage.initialize({
  codex: path.join(home, ".codex", "sessions"),
  dsh: path.join(home, ".dsh", "sessions"),
  zcode: path.join(home, ".zcode", "sessions"),
  qoder: path.join(home, ".qoder", "projects"),
  workbuddy: path.join(home, ".workbuddy", "projects"),
  workbuddy_ai: path.join(home, ".workbuddy-ai", "projects"),
});
const agentKeys = ["codex", "dsh", "zcode", "qoder", "workbuddy", "workbuddy_ai"];
const triggers = ["manual", "automatic", "unknown"];
const kinds = ["invocation", "document", "request"];
const statuses = ["returned", "returned", "returned", "failed"];
const projects = ["C:/dev/checkout-web-with-a-fairly-long-project-folder-name", "C:/dev/data-pipeline", null];
const now = Date.now();
for (let i = 0; i < 40; i++) {
  const skill = SKILLS[i % SKILLS.length];
  const tool = agentKeys[i % agentKeys.length];
  usage.put({
    id: `colw-${String(i).padStart(3, "0")}`,
    tool,
    skillName: skill[0],
    skillPath: path.join(home, ".skills-manager", "skills", skill[0], "SKILL.md"),
    timestamp: now - i * 41 * 60 * 1000,
    sessionId: `session-${String(i % 7).padStart(2, "0")}`,
    project: projects[i % projects.length],
    callId: `call_${200 + i}`,
    kind: kinds[i % kinds.length],
    trigger: triggers[i % triggers.length],
    status: statuses[i % statuses.length],
    evidence: "user_selection",
    sourcePath: path.join(home, `.${tool}`, "sessions", `session-${i}.jsonl`),
    sourceLine: String(50 + i),
  });
}
usage.close();
console.log(`seeded: skills=${SKILLS.length} activity=40 preset=${presetId} root=${path.relative(process.cwd(), root)}`);
