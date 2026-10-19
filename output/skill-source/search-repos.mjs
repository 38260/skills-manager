// 为「本机没有来源记录」的技能搜索上游 GitHub 仓库，两级判据：
//   A 级（确证）：SKILL.md 的 description 前 100 字符逐字相同（同 verify-repos.mjs）。
//   B 级（疑似同源）：名字相同 + 拉丁标识符签名（脚本名/参数/模型名/URL）高度重合，
//                    用于抓「被翻译成中文或本地化改写过的同一技能」。
// 只读：GitHub 搜索 + contents 接口 + 本机 SKILL.md；不写任何用户数据。
// 用法：node output/skill-source/search-repos.mjs [技能名...]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const ALREADY = new Set([
  "animation-vocabulary", "apple-design", "emil-design-eng", "find-animation-opportunities",
  "improve-animations", "review-animations", "frontend-design", "skill-creator", "figma",
  "pdf", "playwright", "grill-me", "archify", "dashi-ppt",
]);

const SKILLS_ROOT = path.join(os.homedir(), ".skills-manager", "skills");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();

const db = new DatabaseSync(path.join(os.homedir(), ".skills-manager", "skills-manager.db"), { readOnly: true });
const wanted = db
  .prepare("SELECT DISTINCT name FROM skills WHERE source_type IN ('local','import') ORDER BY name")
  .all().map(row => row.name).filter(name => !ALREADY.has(name));
db.close();
const only = process.argv.slice(2);
const targets = only.length ? wanted.filter(name => only.includes(name)) : wanted;

const unquote = value => {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  const quote = text[0];
  return (quote === '"' || quote === "'") && text.length > 1 && text.endsWith(quote) ? text.slice(1, -1).trim() : text;
};
const frontOf = text => (/^---\r?\n([\s\S]*?)\r?\n---/.exec(text) ?? [])[1] ?? "";
const descriptionOf = text => {
  const front = frontOf(text);
  const line = /^description:\s*([\s\S]*?)(?=\n[A-Za-z_-]+:|\s*$)/m.exec(front);
  if (line) return unquote(line[1].replace(/^\s*[>|]-?\s*/, ""));
  return unquote((/^name:\s*(.+)$/m.exec(front) ?? [])[1] ?? "");
};
const nameOf = text => unquote((/^name:\s*(.+)$/m.exec(frontOf(text)) ?? [])[1] ?? "");
// 签名 = 拉丁标识符（脚本名、CLI 参数、模型名、域名…）。翻译过的副本仍会保留这些。
const STOP = new Set(["skill", "skills", "when", "user", "this", "that", "with", "from", "http", "https", "com", "md", "name", "description", "code", "bash", "node", "path", "url", "api", "the", "and", "for", "you", "use", "files", "file", "text", "tool", "tools", "prompt", "commands", "command"]);
const signature = text => new Set((text.toLowerCase().match(/[a-z][a-z0-9_$./-]{4,}/g) ?? [])
  .map(t => t.replace(/^\.+|\.+$/g, "")).filter(t => t.length >= 5 && !STOP.has(t) && !/^\d+$/.test(t)));
const coverage = (a, b) => { let hit = 0; for (const t of a) if (b.has(t)) hit += 1; return a.size ? hit / a.size : 0; };

const gh = async (url, { search = false, auth = true } = {}) => {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        headers: { ...(auth ? { authorization: `Bearer ${token}` } : {}), accept: "application/vnd.github+json", "user-agent": "skills-manager" },
        signal: AbortSignal.timeout(25000),
      });
    } catch { await sleep(2000 * attempt); continue; }
    if (response.status === 403 || response.status === 429) {
      const reset = Number(response.headers.get("x-ratelimit-reset") ?? 0);
      const wait = reset ? Math.max(2500, reset * 1000 - Date.now() + 2000) : 10000 * attempt;
      console.log(`    …限流${search ? "（搜索）" : ""}，等待 ${Math.round(Math.min(wait, 75000) / 1000)}s`);
      await sleep(Math.min(wait, 75000));
      continue;
    }
    if (!response.ok) return { status: response.status, json: null };
    return { status: response.status, json: await response.json() };
  }
  return { status: 0, json: null };
};
// 本机直连 raw.githubusercontent.com 会被重置，一律走 contents 接口取 base64。
const fileOf = async (repo, filePath) => {
  const res = await gh(`https://api.github.com/repos/${repo}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}`);
  if (!res.json?.content) return null;
  return Buffer.from(res.json.content, "base64").toString("utf8");
};

const out = [];
for (const name of targets) {
  const localFile = path.join(SKILLS_ROOT, name, "SKILL.md");
  if (!fs.existsSync(localFile)) { out.push({ name, verdict: "no-local-file", matches: [] }); continue; }
  const localText = fs.readFileSync(localFile, "utf8");
  const mine = descriptionOf(localText), mineSig = signature(localText);

  // MODE=phrase 时用描述里最独特的一段做全文检索：能捞到目录名不叫技能名、或被搬运改名的副本。
  const phrase = mine.replace(/["“”‘’「」『』]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  const queries = process.env.MODE === "phrase" && phrase.length >= 18
    ? [`"${phrase}"`, `"${name}" filename:SKILL.md`]
    : [`"${name}" filename:SKILL.md`];
  const items = [];
  for (const q of queries) {
    const search = await gh(`https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=30`, { search: true });
    await sleep(2300);
    items.push(...(search.json?.items ?? []));
  }
  // 仓库名就叫这个技能 → 通常是作者自己的仓库；别人的 skills 目录只是副本。
  const repoSearch = await gh(`https://api.github.com/search/repositories?q=${encodeURIComponent(name)}&per_page=15`, { search: true });
  await sleep(2300);
  const nameRepos = new Set((repoSearch.json?.items ?? []).map(repo => repo.full_name?.toLowerCase()));
  // 优先看「仓库名==技能名」和路径更浅的：那是原作者仓库的典型形状，而非别人的 skills 目录副本。
  const ranked = items.map(item => ({ repo: item.repository?.full_name ?? "", filePath: item.path }))
    .filter(cand => cand.repo && cand.filePath?.toLowerCase().endsWith(process.env.MODE === "phrase" ? ".md" : "skill.md"))
    .sort((a, b) => {
      const score = cand => (cand.repo.split("/")[1]?.toLowerCase() === name.toLowerCase() ? 0 : 2)
        + (cand.filePath === "SKILL.md" ? 0 : 1) + (cand.filePath.split("/").length > 3 ? 1 : 0);
      return score(a) - score(b);
    });
  const seen = new Set();
  const shortlist = ranked.filter(cand => !seen.has(`${cand.repo}:${cand.filePath}`) && (seen.add(`${cand.repo}:${cand.filePath}`), true)).slice(0, 12);

  const matches = [];
  for (const cand of shortlist) {
    const text = await fileOf(cand.repo, cand.filePath);
    await sleep(150);
    if (!text) continue;
    const theirs = descriptionOf(text);
    const head = Math.min(100, mine.length, theirs.length);
    const exact = head >= 30 && mine.slice(0, head) === theirs.slice(0, head);
    const theirSig = signature(text);
    const overlap = Math.min(coverage(mineSig, theirSig), coverage(theirSig, mineSig));
    const sameName = nameOf(text).toLowerCase() === name.toLowerCase();
    if (!exact && !sameName && overlap < 0.5) continue;
    const repoInfo = (await gh(`https://api.github.com/repos/${cand.repo}`)).json ?? {};
    matches.push({
      repo: cand.repo, path: cand.filePath, tier: exact ? "A" : "B",
      nameMatch: sameName, overlap: Number(overlap.toFixed(2)),
      repoNamed: nameRepos.has(cand.repo.toLowerCase()),
      stars: repoInfo.stargazers_count ?? null,
      created: String(repoInfo.created_at ?? "").slice(0, 10),
      ownerType: repoInfo.owner?.type ?? null,
      ownerName: repoInfo.owner?.name ?? null,
      upstreamAuthor: unquote((/^author:\s*(.+)$/m.exec(frontOf(text)) ?? [])[1] ?? "")
        || unquote((/^\s+author:\s*(.+)$/m.exec(frontOf(text)) ?? [])[1] ?? ""),
    });
  }
  const earliest = matches.length ? matches.reduce((min, m) => (m.created && m.created < min ? m.created : min), "9999") : null;
  for (const match of matches) {
    // 起源分：描述逐字一致 > 仓库就以技能命名 > 签名重合高 > 建库最早 > 关注度高。
    match.origin = (match.tier === "A" ? 3 : 0) + (match.repoNamed ? 3 : 0)
      + Math.min(2, match.overlap * 2) + (match.created && match.created === earliest ? 2 : 0)
      + Math.min(1.5, Math.log10((match.stars ?? 0) + 1)) + (match.ownerType === "User" ? 0.5 : 0);
  }
  matches.sort((a, b) => b.origin - a.origin);
  out.push({ name, verdict: matches.length ? "found" : "not-found", candidates: shortlist.length, matches });
  console.log(`${name.padEnd(38)} ${matches.length ? matches.slice(0, 3).map(m => `${m.tier}${m.repoNamed ? "*" : ""} ${m.repo} (ovl ${m.overlap}, ★${m.stars}, ${m.created})`).join(" | ") : "— 未找到 (" + shortlist.length + " 候选全不匹配)"}`);
}

fs.writeFileSync(new URL(process.env.OUTPUT ?? "./search-result.json", import.meta.url), JSON.stringify(out, null, 1));
console.log("\n未找到：" + out.filter(row => row.verdict === "not-found").map(row => row.name).join(" "));
console.log("写入 search-result.json");
