// 微基准：全局工作区那条链路的成本构成（哈希内容 vs 只是 stat）。
// 用法：node output/page-perf/measure-workspace.mjs [agentSkillsDir]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { files, hashDirectory, metadata, canonical } from "../../backend/files.mjs";
import { readSkillsRoot, withCenterState } from "../../backend/workspace.mjs";

const roots = process.argv.slice(2);
const targets = roots.length ? roots : [
  path.join(os.homedir(), ".claude/skills"),
  path.join(os.homedir(), ".workbuddy/skills"),
  path.join(os.homedir(), ".codex/skills"),
  path.join(os.homedir(), ".agents/skills"),
];

const time = fn => { const started = performance.now(); const value = fn(); return { ms: performance.now() - started, value }; };

for (const root of targets) {
  if (!fs.existsSync(root)) { console.log(`— 跳过（不存在）：${root}`); continue; }
  console.log(`\n=== ${root} ===`);
  const skills = readSkillsRoot(root, { enabled: true, agent: "probe", agentDisplayName: "probe" });
  console.log(`技能目录 ${skills.length} 个`);

  let filesCount = 0, bytes = 0;
  const uniqueDirs = new Set();
  for (const info of skills) {
    uniqueDirs.add(canonical(info.path));
    for (const file of files(info.path)) { filesCount++; bytes += file.size; }
  }
  console.log(`唯一物理目录 ${uniqueDirs.size} 个；合计 ${filesCount} 个文件 / ${(bytes / 1048576).toFixed(1)}MB`);

  // 全部内容哈希一遍
  const hashing = time(() => {
    let n = 0;
    for (const info of skills) hashDirectory(info.path), n++;
    return n;
  });
  // 只 stat（mtime + size），不读内容
  const statting = time(() => {
    let latest = 0;
    for (const info of skills) for (const file of files(info.path)) { const m = fs.statSync(file.full).mtimeMs; if (m > latest) latest = m; }
    return latest;
  });
  // metadata 读取（frontmatter）
  const meta = time(() => { let n = 0; for (const info of skills) metadata(info.path), n++; return n; });
  // 完整读一次（含 readSkillsRoot 内部重复的哈希/统计）
  const full = time(() => readSkillsRoot(root, { enabled: true, agent: "probe", agentDisplayName: "probe" }));

  console.log(`  readSkillsRoot 整体           ${full.ms.toFixed(0)}ms`);
  console.log(`  （其中）内容哈希全量            ${hashing.ms.toFixed(0)}ms`);
  console.log(`  （其中）纯 stat 遍历           ${statting.ms.toFixed(0)}ms`);
  console.log(`  （其中）metadata 解析          ${meta.ms.toFixed(0)}ms`);
  console.log(`  ⇒ 一次请求里「哈希 + stat」的重复量：内容哈希 ${hashing.ms > 0 ? (full.ms / hashing.ms).toFixed(1) : "-"}× 于单遍哈希`);
}
