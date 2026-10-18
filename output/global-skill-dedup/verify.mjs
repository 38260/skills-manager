import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "../..");
const data = path.join(directory, "data");
const baselineFile = path.join(data, "before.json");
const home = "C:/Users/luckyzyb";
const central = `${home}/.skills-manager/skills`;
const plan = [
  { name: "dashi-ppt", source: `${home}/.codex/skills/dashi-ppt`, backup: `${home}/.codex/skill-dedup-backups/2026-10-18/dashi-ppt`, action: "remove-extra-entry" },
  ...["archify", "design-taste-frontend", "web-design-guidelines"].map(name => ({ name, source: `${home}/.agents/skills/${name}`, backup: `${home}/.agents/skill-dedup-backups/2026-10-18/${name}`, action: "junction" })),
  { name: "ai-rereseach", source: "D:/AICache/WorkBuddy/.workbuddy/skills/ai-rereseach", backup: "D:/AICache/WorkBuddy/.workbuddy/skill-dedup-backups/2026-10-18/ai-rereseach", action: "junction" },
].map(item => ({ ...item, central: `${central}/${item.name}` }));
const hash = content => crypto.createHash("sha256").update(content).digest("hex");
const real = filename => fs.realpathSync.native(filename).toLowerCase();
const git = args => execFileSync("git", args, { cwd: repository, encoding: "utf8" });
// 依赖、缓存与管理元数据不参与技能内容比较；原目录整体移到备份，不丢弃这些内容。
const ignored = new Set([".git", ".skills-manager", "node_modules", "__pycache__", ".DS_Store", "Thumbs.db"]);
function manifest(root, prefix = "") {
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.name.endsWith(".pyc")) continue;
    const relative = prefix + entry.name;
    const full = path.join(root, entry.name);
    if (entry.isSymbolicLink()) result.push({ path: relative, target: fs.readlinkSync(full) });
    else if (entry.isDirectory()) result.push(...manifest(full, `${relative}/`));
    else if (entry.isFile()) result.push({ path: relative, sha256: hash(fs.readFileSync(full)) });
  }
  return result.sort((a, b) => a.path.localeCompare(b.path, "en"));
}
function databaseState() {
  const db = new DatabaseSync(`${home}/.skills-manager/skills-manager.db`, { readOnly: true });
  try {
    return {
      targets: db.prepare("SELECT * FROM skill_targets ORDER BY id").all(),
      settings: db.prepare("SELECT key,value FROM settings WHERE key IN ('sync_mode','custom_tool_paths','custom_tools','disabled_tools','hidden_tools') ORDER BY key").all(),
    };
  } finally { db.close(); }
}
const protectedPaths = [
  `${central}/find-skills`, `${central}/find-skills-54015c47`, `${central}/skill-creator`,
  `${home}/.codex/skills/.system/skill-creator`, `${central}/pdf`,
  `${home}/.codex/plugins/cache/openai-primary-runtime/pdf/26.1015.12040/skills/pdf`,
];
function assertCentral(item) {
  assert.deepEqual(manifest(item.central), item.content, `${item.name}: 中央库内容发生变化`);
}
function before(item) {
  assertCentral(item);
  assert.equal(fs.lstatSync(item.source).isSymbolicLink(), false, `${item.name}: 原入口不再是实体目录`);
  assert.equal(fs.existsSync(item.backup), false, `${item.name}: 备份目录已存在`);
  assert.deepEqual(manifest(item.source), item.content, `${item.name}: 副本内容发生变化`);
}
function after(item) {
  assertCentral(item);
  assert.equal(fs.lstatSync(item.backup).isSymbolicLink(), false, `${item.name}: 备份必须为原实体目录`);
  assert.deepEqual(manifest(item.backup), item.content, `${item.name}: 备份内容不一致`);
  assert.equal(fs.statSync(path.join(item.backup, "SKILL.md")).ino.toString(), item.originalFileId, `${item.name}: 备份不是移走的原文件`);
  if (item.action === "junction") {
    assert.equal(fs.lstatSync(item.source).isSymbolicLink(), true);
    assert.equal(real(item.source), real(item.central));
    assert.ok(fs.readFileSync(path.join(item.source, "SKILL.md")).length);
  } else {
    assert.equal(fs.existsSync(item.source), false);
    assert.equal(real(`${home}/.agents/skills/dashi-ppt`), real(item.central));
    assert.ok(fs.readFileSync(`${home}/.agents/skills/dashi-ppt/SKILL.md`).length);
  }
  return { name: item.name, action: item.action, status: "passed", files: item.content.length, backup: item.backup };
}

const [command, name] = process.argv.slice(2);
if (command === "capture") {
  assert.equal(fs.existsSync(baselineFile), false, "基线已存在，禁止覆盖");
  for (const item of plan) {
    item.content = manifest(item.central);
    item.originalFileId = fs.statSync(path.join(item.source, "SKILL.md")).ino.toString();
    before(item);
  }
  const dirtyFiles = git(["diff", "--name-only", "-z"]).split("\0").filter(Boolean).map(filename => ({ filename, sha256: hash(fs.readFileSync(path.join(repository, filename))) }));
  const baseline = { plan, database: databaseState(), protected: protectedPaths.map(filename => ({ filename, content: manifest(filename) })), dirtyFiles, originalUntracked: git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean) };
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(baselineFile, JSON.stringify(baseline, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: "captured", skills: plan.map(item => ({ name: item.name, files: item.content.length })), userDirtyFiles: dirtyFiles.length, bindings: baseline.database.targets.length }));
} else {
  const baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
  if (command === "before" || command === "after") {
    const item = baseline.plan.find(item => item.name === name);
    assert.ok(item, "未知技能，拒绝操作");
    console.log(JSON.stringify(command === "before" ? (before(item), { name, status: "ready" }) : after(item)));
  } else {
    assert.equal(command, "verify", "仅支持 capture / before / after / verify");
    const results = baseline.plan.map(after);
    assert.deepEqual(databaseState(), baseline.database, "原有部署绑定或工具设置发生变化");
    for (const item of baseline.protected) assert.deepEqual(manifest(item.filename), item.content, `同名不同内容的技能被改动: ${item.filename}`);
    for (const item of baseline.dirtyFiles) assert.equal(hash(fs.readFileSync(path.join(repository, item.filename))), item.sha256, `用户原有修改被改动: ${item.filename}`);
    for (const filename of baseline.originalUntracked) assert.ok(fs.existsSync(path.join(repository, filename)), `用户原有未跟踪文件缺失: ${filename}`);
    const result = { status: "passed", results, bindingsUnchanged: baseline.database.targets.length, protectedVariantsUnchanged: baseline.protected.length, userDirtyFilesUnchanged: baseline.dirtyFiles.length, userUntrackedFilesPreserved: baseline.originalUntracked.length };
    fs.writeFileSync(path.join(data, "after.json"), JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result));
  }
}
