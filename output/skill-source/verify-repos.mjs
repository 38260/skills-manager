// 逐个核对「本机技能 ↔ GitHub 仓库」：
//   ① 对若干知名「技能集」仓库各取一次 git 文件树（每个仓库 1 次 API 请求）；
//   ② 用本机技能库里每个技能名去匹配 `<技能名>/SKILL.md`；
//   ③ 命中后抓该文件的原文，与本机 SKILL.md 的 description 比对 —— 内容对得上才算确证。
// 只读本机技能文件 + 只读 GitHub 公开接口；不写任何用户数据。
// 用法：node output/skill-source/verify-repos.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_REPOS = [
  "anthropics/skills", "emilkowalski/skills", "mattpocock/skills", "openai/skills",
  "vercel-labs/skills", "pbakaus/impeccable", "leonxlnx/taste-skill", "tt-a1i/archify",
  "kkkkhazix/khazix-skills", "chuspeeism/dashi-ppt-skill", "asuojun/claude-vision-skill",
  "xiaoduoya/codex-with-chatgpt", "heygen-com/hyperframes", "microsoft/azure-skills",
];
// 支持只跑指定仓库，便于复核：node output/skill-source/verify-repos.mjs tt-a1i/archify
const REPOS = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_REPOS;

const LOCAL_ROOT = path.join(os.homedir(), ".skills-manager", "skills");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const db = new DatabaseSync(path.join(os.homedir(), ".skills-manager", "skills-manager.db"), { readOnly: true });
const localNames = db.prepare("SELECT name FROM skills WHERE source_type IN ('local','import') ORDER BY name").all().map(row => row.name);
db.close();

const get = async url => {
  const response = await fetch(url, { headers: { "user-agent": "skills-manager", accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(20000) });
  return { status: response.status, text: await response.text() };
};
// YAML 里 description 常被引号包裹（甚至多行折叠），先压缩空白再成对剥引号，
// 否则「内容逐字相同、只差外层引号」会被判成不一致（archify 实际踩过）。
const unquote = value => {
  const text = value.trim().replace(/\s+/g, " ");
  const quote = text[0];
  return (quote === '"' || quote === "'") && text.length > 1 && text.endsWith(quote) ? text.slice(1, -1).trim() : text;
};
const descriptionOf = text => {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!front) return "";
  const line = /^description:\s*([\s\S]*?)(?=\n[A-Za-z_-]+:|\s*$)/m.exec(front[1]);
  if (line) return unquote(line[1].replace(/^\s*[>|]-?\s*/, ""));
  return unquote((/^name:\s*(.+)$/m.exec(front[1]) ?? [])[1] ?? "");
};

const confirmed = new Map(), conflicts = [], errors = [];
for (const repo of REPOS) {
  const { status, text } = await get(`https://api.github.com/repos/${repo}/git/trees/HEAD?recursive=1`);
  await sleep(250);
  if (status !== 200) { errors.push(`${repo} 文件树 HTTP ${status}`); continue; }
  const paths = (JSON.parse(text).tree ?? []).map(item => item.path);
  for (const name of localNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hit = paths.find(p => new RegExp(`(^|/)${escaped}/SKILL\\.md$`).test(p));
    if (!hit) continue;
    const local = path.join(LOCAL_ROOT, name, "SKILL.md");
    if (!fs.existsSync(local)) continue;
    const raw = await get(`https://raw.githubusercontent.com/${repo}/HEAD/${hit}`);
    await sleep(120);
    // 判据：description 的**前 100 个字符逐字相同**。同名不同物的技能不可能撞这么长一段，
    // 而同物可能因版本/排版（YAML 引号、折叠换行、尾部补写）而整体不等，所以不要求全文相等。
    const mine = descriptionOf(fs.readFileSync(local, "utf8")), theirs = descriptionOf(raw.text);
    const head = Math.min(100, mine.length, theirs.length);
    const matched = head >= 30 && mine.slice(0, head) === theirs.slice(0, head);
    if (matched) { if (!confirmed.has(name)) confirmed.set(name, []); confirmed.get(name).push(repo); }
    else conflicts.push({ name, repo, path: hit, mine: mine.slice(0, head), theirs: theirs.slice(0, head) });
  }
}

console.log(`=== ✅ 描述完全一致（确证 ${confirmed.size} 个）===`);
for (const [name, repos] of confirmed) console.log(`  ${name.padEnd(30)} ${repos.join(" , ")}`);
console.log(`\n=== ❓ 找到同名目录但描述不同（不采用 ${conflicts.length} 条）===`);
for (const c of conflicts) console.log(`  ${c.name.padEnd(30)} ${c.repo.padEnd(28)} ${c.path}\n      本机: ${c.mine}\n      远端: ${c.theirs}`);
if (errors.length) console.log(`\n=== ⚠ 请求异常 ===\n  ${errors.join("\n  ")}`);
console.log(`\n未确证的技能（留空）：${localNames.filter(n => !confirmed.has(n)).join(" ")}`);
