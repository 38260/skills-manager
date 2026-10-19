// 把「候选仓库」与本机技能逐字比对：取仓库文件树 → 找 SKILL.md → 比 description 前 100 字 + 拉丁标识符签名。
// 只读。用法：node output/skill-source/check-pairs.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SKILLS_ROOT = path.join(os.homedir(), ".skills-manager", "skills");
const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// 本机技能名 → 待核实的候选仓库（来自 search/repositories 的名字命中）
const PAIRS = {
  "thesis-review": ["YeyeQian/codex-thesis-review-skills", "mochuishle/Thesis-Review-Skill", "butyuhao/review-engineering-phd-thesis"],
  "zotero-pdf-annotate": ["WenyuChiou/zotero-skills"],
  "verified-literature-survey": ["LIANJie-Jason/literature-helper-polsci", "DanieleMosh/almagest-survey"],
  "nature-figure-qa-gate": ["Yuanz0825/nature-skills"],
  "self-improving-agent": ["huamu668/clawhub-self-improving-agent"],
  "craft-prompts": ["insaaniManav/prompt-forge"],
};
// 追加：按中文关键词再搜一轮仓库
const EXTRA_SEARCH = {
  "design-pitfall-cn": "前端设计避坑 skill",
  "project-idea-research": "想法查重 竞品研究 skill",
  "ppt-template-replica": "PPT 模板 复刻 skill",
  "remotion-data-race-video": "remotion bar chart race skill",
  "domain-learning-companion": "领域学习 入门 skill",
  "recipe": "菜谱 食谱 skill",
  "product-research": "产品立项 竞品研究 skill",
};

const unquote = v => { const t = String(v ?? "").trim().replace(/\s+/g, " "); const q = t[0]; return (q === '"' || q === "'") && t.length > 1 && t.endsWith(q) ? t.slice(1, -1).trim() : t; };
const frontOf = t => (/^---\r?\n([\s\S]*?)\r?\n---/.exec(t) ?? [])[1] ?? "";
const descriptionOf = t => { const f = frontOf(t); const l = /^description:\s*([\s\S]*?)(?=\n[A-Za-z_-]+:|\s*$)/m.exec(f); return l ? unquote(l[1].replace(/^\s*[>|]-?\s*/, "")) : unquote((/^name:\s*(.+)$/m.exec(f) ?? [])[1] ?? ""); };
const STOP = new Set(["skill", "skills", "when", "user", "this", "that", "with", "from", "http", "https", "com", "md", "name", "description", "code", "bash", "node", "path", "url", "api", "the", "and", "for", "you", "use", "files", "file", "text", "tool", "tools", "prompt", "commands", "command"]);
const signature = t => new Set((t.toLowerCase().match(/[a-z][a-z0-9_$./-]{4,}/g) ?? []).map(x => x.replace(/^\.+|\.+$/g, "")).filter(x => x.length >= 5 && !STOP.has(x) && !/^\d+$/.test(x)));
const coverage = (a, b) => { let h = 0; for (const x of a) if (b.has(x)) h += 1; return a.size ? h / a.size : 0; };

const gh = async u => { for (let i = 0; i < 3; i += 1) { try { const r = await fetch("https://api.github.com/" + u, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(25000) }); if (r.ok) return await r.json(); if (r.status === 403 || r.status === 429) { await sleep(20000); continue; } return null; } catch { await sleep(2000); } } return null; };

const report = [];
for (const [name, repos] of Object.entries(PAIRS)) {
  const localFile = path.join(SKILLS_ROOT, name, "SKILL.md");
  if (!fs.existsSync(localFile)) { report.push(`${name}: 本机无文件`); continue; }
  const localText = fs.readFileSync(localFile, "utf8");
  const mine = descriptionOf(localText), mineSig = signature(localText);
  for (const repo of repos) {
    const info = await gh(`repos/${repo}`);
    await sleep(300);
    if (!info) { report.push(`${name} ← ${repo}: 仓库取不到`); continue; }
    const tree = await gh(`repos/${repo}/git/trees/${encodeURIComponent(info.default_branch)}?recursive=1`);
    await sleep(300);
    const skillFiles = (tree?.tree ?? []).filter(t => /(^|\/)SKILL\.md$/.test(t.path)).map(t => t.path);
    const verdicts = [];
    for (const filePath of skillFiles.slice(0, 12)) {
      const c = await gh(`repos/${repo}/contents/${filePath}`);
      await sleep(200);
      if (!c?.content) continue;
      const text = Buffer.from(c.content, "base64").toString("utf8");
      const theirs = descriptionOf(text);
      const head = Math.min(100, mine.length, theirs.length);
      const exact = head >= 30 && mine.slice(0, head) === theirs.slice(0, head);
      const theirSig = signature(text);
      const ovl = Math.min(coverage(mineSig, theirSig), coverage(theirSig, mineSig));
      if (exact || ovl >= 0.2) verdicts.push(`${filePath}${exact ? " 逐字一致" : ""} ovl=${ovl.toFixed(2)} :: ${theirs.slice(0, 70)}`);
    }
    report.push(`${name} ← ${repo} (★${info.stargazers_count}, ${String(info.description).slice(0, 50)})\n   SKILL.md 数=${skillFiles.length}\n   ${verdicts.length ? verdicts.join("\n   ") : "无一条描述逐字一致或签名重合≥0.2"}`);
  }
}
for (const [name, query] of Object.entries(EXTRA_SEARCH)) {
  const j = await gh(`search/repositories?q=${encodeURIComponent(query)}&per_page=6`);
  await sleep(2500);
  report.push(`[仓库搜索 ${name}] ${query}\n   ${(j?.items ?? []).map(r => `${r.full_name} ★${r.stargazers_count} ${String(r.description || "").slice(0, 60)}`).join("\n   ") || "无结果"}`);
}
console.log(report.join("\n\n"));
