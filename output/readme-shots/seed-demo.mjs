// README 截图专用：**纯虚构**演示数据，绝不能出现用户真实技能名 / 本机路径 / 真实调用记录。
// 演示 home 用短路径 D:/sm-demo，页面上出现的路径一眼可辨是演示环境。
// 用法：node output/readme-shots/seed-demo.mjs
import fs from "node:fs";
import path from "node:path";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";
import { UsageStore } from "../../backend/activity/store.mjs";

const HOME = "D:/sm-demo";
const root = path.join(HOME, "upstream");

// 只清我们自己造的两个目录（沙箱里 rmSync 会走回收站，用 Node 的 rm 逐个文件删不动时就直接覆盖写）
for (const stale of [path.join(HOME, ".skills-manager"), path.join(HOME, ".skills-manager-activity")]) {
  if (fs.existsSync(stale)) fs.rmSync(stale, { recursive: true, force: true });
}

// 让若干个 Agent 被检测到（目录名是公开产品名，不是个人信息）
for (const tool of [".codex", ".cursor", ".qoder", ".zcode", ".workbuddy", ".dsh"]) {
  fs.mkdirSync(path.join(HOME, tool, "skills"), { recursive: true });
}

const store = new Store({ directory: path.join(HOME, ".skills-manager"), home: HOME });
store.setSetting("backup_auto_enabled", "off");
store.setSetting("backup_first_run_prompt", "fresh");
store.setSetting("sync_mode", "copy");

const SKILLS = [
  ["release-notes", "Turn merged pull requests into a structured release note.", ["docs", "release"], "Demo Author"],
  ["api-contract-review", "Compare an OpenAPI spec against the implementation and flag drift.", ["api", "review"], "Ada Chen"],
  ["migration-safety", "Check database migrations for lock risk and rollback gaps.", ["database", "review"], "Ada Chen"],
  ["i18n-key-sync", "Find missing, unused and renamed translation keys.", ["i18n", "frontend"], "Demo Author"],
  ["bundle-budget", "Enforce a front-end bundle size budget and explain regressions.", ["performance"], "团队共享"],
  ["docker-slim", "Trim Docker layers and build cache without changing behaviour.", ["devops"], "团队共享"],
  ["postmortem-writer", "Structure an incident timeline and draft a blameless postmortem.", ["writing"], "Demo Author"],
  ["a11y-audit", "Run an accessibility checklist over a page and produce concrete fixes.", ["a11y", "frontend", "review"], "Lena Ortiz"],
  // 一个不带分类的技能，用来展示「未分类 / 未标注」筛选
  ["notes-to-tasks", "Turn an unstructured notes file into a prioritised task list.", [], "Demo Author"],
];

const library = new Library(store);
const presetId = store.presets()[0].id;
const installed = [];
for (const [name, description, tags, author] of SKILLS) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---
name: ${name}
description: ${description}
metadata:
  author: ${author}
---

# ${name}

${description}

## 使用方式

把本目录放到技能的搜索路径下即可被 Agent 读取；本应用会把它收进中央库并按 Preset 部署。
`);
  const skill = await library.installLocal(dir);
  if (tags.length) store.setTags(skill.id, tags);
  store.addSkillToPreset(skill.id, presetId);
  store.scenarioSkillTools(presetId, skill.id);
  installed.push({ id: skill.id, name, centralPath: skill.central_path });
}

// ── 部署到若干 Agent：让「部署覆盖」「各 Agent 已部署数」「工作区」都有真实内容 ──
const PLAN = [
  ["codex", ["release-notes", "api-contract-review", "migration-safety", "i18n-key-sync", "a11y-audit"]],
  ["cursor", ["release-notes", "bundle-budget", "a11y-audit"]],
  ["qoder", ["api-contract-review", "migration-safety"]],
  ["zcode", ["release-notes", "postmortem-writer"]],
  ["workbuddy", ["release-notes", "notes-to-tasks", "docker-slim", "postmortem-writer"]],
];
for (const [tool, names] of PLAN) {
  for (const name of names) {
    const target = installed.find(item => item.name === name);
    if (target) await library.deploy(target.id, tool);
  }
}

// ── 项目工作区：一个同步一致、一个内容有差异（工作台会给出同步提醒）──
function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full); else yield full;
  }
}
function seedProject(name, folder, { diverge }) {
  const projectPath = path.join(HOME, "projects", folder);
  const skillsDir = path.join(projectPath, ".codex", "skills");
  fs.mkdirSync(skillsDir, { recursive: true });
  const source = installed[0];
  const copy = path.join(skillsDir, source.name);
  fs.cpSync(source.centralPath, copy, { recursive: true });
  if (diverge) fs.appendFileSync(path.join(copy, "SKILL.md"), "\n## 项目内补充\n\n项目副本与中央库主本内容不一致。\n");
  const stamp = Date.now() / 1000;
  for (const target of [copy, source.centralPath]) for (const file of walk(target)) fs.utimesSync(file, stamp, stamp);
  store.insertProject({ name, projectPath, workspaceType: "project" });
}
seedProject("checkout-web", "checkout-web", { diverge: false });
seedProject("data-pipeline", "data-pipeline", { diverge: true });

// ── 调用记录：6 个来源 / 3 种触发 / 3 种类型 / 4 种结果，68 条可翻页 ──
const activityDir = path.join(HOME, ".skills-manager-activity");
const usage = new UsageStore(activityDir);
usage.initialize({
  codex: path.join(HOME, ".codex", "sessions"),
  dsh: path.join(HOME, ".dsh", "sessions"),
  zcode: path.join(HOME, ".zcode", "sessions"),
  qoder: path.join(HOME, ".qoder", "projects"),
  workbuddy: path.join(HOME, ".workbuddy", "projects"),
  workbuddy_ai: path.join(HOME, ".workbuddy-ai", "projects"),
});
const tools = ["codex", "dsh", "zcode", "qoder", "workbuddy", "workbuddy_ai"];
const triggers = ["manual", "automatic", "unknown"];
const kinds = ["invocation", "document", "request"];
const statuses = ["returned", "returned", "returned", "failed", "pending", "unknown"];
const projects = ["C:\\dev\\checkout-web", "C:\\dev\\data-pipeline", "C:\\dev\\mobile-app", null];
const now = Date.now();
// 虚构的会话 / 调用 ID（不用真实格式的 UUID，避免看着像谁的真数据）
const sessionOf = i => `demo-session-${String(i % 9).padStart(2, "0")}`;
for (let i = 0; i < 68; i++) {
  const tool = tools[i % tools.length];
  const skill = SKILLS[i % SKILLS.length];
  usage.put({
    id: `demo-${String(i).padStart(3, "0")}`,
    tool,
    skillName: i % 11 === 0 ? `unmatched-skill-${i}` : skill[0],
    skillPath: i % 7 === 0 ? null : path.join(HOME, ".skills-manager", "skills", skill[0], "SKILL.md"),
    timestamp: now - i * 37 * 60 * 1000,
    sessionId: sessionOf(i),
    project: projects[i % projects.length],
    callId: `demo-call-${100 + i}`,
    kind: kinds[i % kinds.length],
    trigger: triggers[i % triggers.length],
    status: statuses[i % statuses.length],
    evidence: triggers[i % triggers.length] === "manual" ? "user_selection" : triggers[i % triggers.length] === "automatic" ? "user_auto_choice" : "document_read",
    sourcePath: path.join(HOME, `.${tool === "workbuddy_ai" ? "workbuddy-ai" : tool}`, "sessions", `${sessionOf(i)}.jsonl`),
    sourceLine: String(100 + i * 3),
  });
}
usage.close();

console.log(`演示数据已就绪：home=${HOME} 技能=${installed.length} 项目=2 调用记录=68`);
