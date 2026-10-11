import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { metadata, hashDirectory, canonical } from "./files.mjs";
import { fetchLeaderboard, searchSkills } from "./skillssh.mjs";

// 本地技能扫描与认领导入：扫描各工具全局技能目录，跳过已纳管路径与指向技能库的符号链接，
// 结果按内容指纹分组写入 discovered_skills 表；重复扫描整体重建。
const SKIP = new Set([".git", ".hub", "node_modules", ".skills-manager"]);

function isSkillDir(directory) {
  return fs.existsSync(directory) && ["SKILL.md", "skill.md"].some(name => fs.existsSync(path.join(directory, name)));
}

function linksIntoCentral(entry, centralSkills) {
  try {
    if (!fs.lstatSync(entry).isSymbolicLink()) return false;
    return canonical(fs.realpathSync(entry)).startsWith(canonical(centralSkills));
  } catch { return false; }
}

function collectSkillDirs(root, centralSkills, depth = 0) {
  if (!fs.existsSync(root) || depth > 6) return [];
  const results = [];
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
    const full = path.join(root, entry.name);
    if (linksIntoCentral(full, centralSkills)) continue;
    if (isSkillDir(full)) { results.push(full); continue; }
    if (entry.isSymbolicLink()) continue;
    results.push(...collectSkillDirs(full, centralSkills, depth + 1));
  }
  return results;
}

function groupDiscovered(records) {
  const groups = new Map();
  for (const record of records) {
    const name = record.name_guess || "unknown";
    const key = record.fingerprint ? `fp:${name}:${record.fingerprint}` : `path:${name}:${record.found_path}`;
    if (!groups.has(key)) groups.set(key, { name, fingerprint: record.fingerprint, locations: [], imported: false, found_at: record.found_at });
    const group = groups.get(key);
    if (record.imported_skill_id) group.imported = true;
    if (record.found_at < group.found_at) group.found_at = record.found_at;
    group.locations.push({ id: record.id, tool: record.tool, found_path: record.found_path });
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function scanCommands(store, library) {
  function scanLocalSkills() {
    const centralSkills = store.skillsDirectory;
    const managed = new Set([
      ...store.all("SELECT target_path FROM skill_targets").map(row => canonical(row.target_path)),
      ...store.skills().map(skill => canonical(skill.central_path)),
    ]);
    const discovered = [];
    let toolsScanned = 0;
    for (const tool of store.tools()) {
      const scanRoot = tool.skills_dir;
      const installed = tool.installed;
      if (!installed && !tool.is_custom) continue;
      toolsScanned++;
      if (!installed || !fs.existsSync(scanRoot)) continue;
      const candidates = [];
      if (tool.recursive_scan) {
        candidates.push(...collectSkillDirs(scanRoot, centralSkills));
      } else {
        // 扁平扫描：仅查看技能目录的直接子目录。
        let entries;
        try { entries = fs.readdirSync(scanRoot, { withFileTypes: true }); } catch { entries = []; }
        for (const entry of entries) {
          if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
          if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
          const full = path.join(scanRoot, entry.name);
          if (linksIntoCentral(full, centralSkills)) continue;
          if (isSkillDir(full)) candidates.push(full);
        }
      }
      for (const directory of candidates) {
        if (managed.has(canonical(directory))) continue;
        discovered.push({
          id: crypto.randomUUID(), tool: tool.key, found_path: directory,
          name_guess: metadata(directory).name || path.basename(directory),
          fingerprint: hashDirectory(directory), found_at: fs.statSync(directory).mtimeMs,
          imported_skill_id: null,
        });
      }
    }
    store.run("DELETE FROM discovered_skills");
    for (const record of discovered) {
      store.run("INSERT INTO discovered_skills(id,tool,found_path,name_guess,fingerprint,found_at) VALUES(?,?,?,?,?,?)",
        record.id, record.tool, record.found_path, record.name_guess, record.fingerprint, record.found_at);
    }
    // 已纳管技能通过指纹回填 imported 标记，让分组显示保持一致。
    const skills = store.skills();
    for (const record of discovered) {
      const match = skills.find(skill => skill.content_hash === record.fingerprint);
      if (match) store.run("UPDATE discovered_skills SET imported_skill_id=? WHERE id=?", match.id, record.id);
    }
    const all = store.all("SELECT * FROM discovered_skills");
    return { tools_scanned: toolsScanned, skills_found: discovered.length, groups: groupDiscovered(all) };
  }

  function importExisting(sourcePath, name) {
    const resolved = path.resolve(sourcePath);
    if (!isSkillDir(resolved)) throw new Error("所选目录不是有效技能目录（缺少 SKILL.md）");
    const result = library.install(resolved, { name: name ?? undefined, source_type: "import", source_ref: resolved });
    const match = store.all("SELECT * FROM discovered_skills WHERE fingerprint=? AND imported_skill_id IS NULL", result.content_hash);
    for (const record of match) store.run("UPDATE discovered_skills SET imported_skill_id=? WHERE id=?", result.id, record.id);
    return result;
  }

  return {
    scan_local_skills: { call: () => scanLocalSkills() },
    import_existing_skill: { call: args => { importExisting(args.sourcePath, args.name ?? null); }, mutating: true },
    import_all_discovered: { call: () => {
      const groups = groupDiscovered(store.all("SELECT * FROM discovered_skills"));
      let imported = 0;
      const failed = [];
      for (const group of groups) {
        if (group.imported || !group.locations.length) continue;
        try { importExisting(group.locations[0].found_path, group.name); imported++; }
        catch (error) { failed.push(`${group.name}: ${error.message}`); }
      }
      if (failed.length) throw new Error(`有 ${failed.length} 个技能导入失败：${failed.join("；")}`);
      return { imported };
    }, mutating: true },
    slugify_skill_names: { call: args => (Array.isArray(args.names) ? args.names : []).map(name => slugify(String(name ?? ""))) },
    fetch_leaderboard: { call: args => fetchLeaderboard(String(args.board ?? "alltime")) },
    search_skillssh: { call: args => searchSkills(String(args.query ?? ""), args.limit) },
  };
}

// 目录名清洗：小写字母数字与 -_.，其余折叠为单个连字符；与旧版 slugify 行为一致。
export function slugify(name) {
  let out = "", prevDash = false;
  for (const char of name.toLowerCase()) {
    if (/[a-z0-9\-_.]/.test(char)) { out += char; prevDash = false; }
    else if (!prevDash) { out += "-"; prevDash = true; }
  }
  const trimmed = out.replace(/^[-_.]+|[-_.]+$/g, "");
  return trimmed || "skill";
}
