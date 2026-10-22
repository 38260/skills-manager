import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { metadata, hashDirectory, canonical, files } from "./files.mjs";
import { fetchLeaderboard, searchSkills } from "./skillssh.mjs";

// 本地技能扫描与认领导入：扫描各工具全局技能目录和用户配置的发现目录，
// 跳过已纳管路径与指向技能库的符号链接，结果按内容指纹分组写入 discovered_skills 表。
// 扫描失败时保留最后一次成功结果；部分来源失败时只替换读取成功的来源。
const SKIP = new Set([".git", ".hub", "node_modules", ".skills-manager"]);
const MAX_SCAN_DEPTH = 6;
const DISCOVERY_DIRS_SETTING = "local_discovery_dirs";
const CUSTOM_DISCOVERY_TOOL = "custom_discovery";

function isSkillDir(directory) {
  return fs.existsSync(directory) && ["SKILL.md", "skill.md"].some(name => fs.existsSync(path.join(directory, name)));
}

function linksIntoCentral(entry, centralSkills) {
  try {
    if (!fs.lstatSync(entry).isSymbolicLink()) return false;
    return canonical(fs.realpathSync(entry)).startsWith(canonical(centralSkills));
  } catch { return false; }
}

function errorText(error) {
  return String(error?.code ?? error?.message ?? error);
}

function directoryStatus(directory) {
  let stat;
  try { stat = fs.statSync(directory); }
  catch { return { path: directory, exists: false, readable: false, is_dir: false }; }
  if (!stat.isDirectory()) return { path: directory, exists: true, readable: false, is_dir: false };
  try { fs.accessSync(directory, fs.constants.R_OK); }
  catch { return { path: directory, exists: true, readable: false, is_dir: true }; }
  return { path: directory, exists: true, readable: true, is_dir: true };
}

// 配置读取保持宽容：坏条目跳过而不是让整个发现流程失败；显式配置但已不存在的目录保留在列表中显示状态。
function discoveryDirectories(store) {
  let values;
  try { values = store.settingJson(DISCOVERY_DIRS_SETTING, []); }
  catch { values = []; }
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (!text || !path.isAbsolute(text)) continue;
    const resolved = path.resolve(text);
    if (resolved === path.parse(resolved).root) continue;
    const key = canonical(resolved);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(resolved);
  }
  return result;
}

function listDiscoveryDirectories(store) {
  return discoveryDirectories(store).map(directoryStatus);
}

function validateDiscoveryDirectory(value) {
  const text = String(value ?? "").trim();
  if (!text || !path.isAbsolute(text)) throw new Error("发现目录必须是绝对路径");
  const resolved = path.resolve(text);
  if (resolved === path.parse(resolved).root) throw new Error("不能将磁盘根目录添加为发现目录");
  let stat;
  try { stat = fs.statSync(resolved); }
  catch { throw new Error("发现目录不存在或不可访问"); }
  if (!stat.isDirectory()) throw new Error("所选路径不是目录");
  try { fs.accessSync(resolved, fs.constants.R_OK); }
  catch { throw new Error("发现目录不可读"); }
  return resolved;
}

function addDiscoveryDirectory(store, value) {
  const directory = validateDiscoveryDirectory(value);
  const existing = discoveryDirectories(store);
  if (existing.some(item => canonical(item) === canonical(directory))) {
    return { added: false, dirs: listDiscoveryDirectories(store) };
  }
  store.setSetting(DISCOVERY_DIRS_SETTING, JSON.stringify([...existing, directory]));
  return { added: true, dirs: listDiscoveryDirectories(store) };
}

function removeDiscoveryDirectory(store, value) {
  const target = path.resolve(String(value ?? ""));
  const existing = discoveryDirectories(store);
  const next = existing.filter(item => canonical(item) !== canonical(target));
  if (next.length !== existing.length) store.setSetting(DISCOVERY_DIRS_SETTING, JSON.stringify(next));
  return { removed: next.length !== existing.length, dirs: listDiscoveryDirectories(store) };
}

function listingSignature(listing) {
  const hash = crypto.createHash("sha1");
  for (const file of listing) {
    hash.update(file.relative);
    hash.update("\0");
    hash.update(String(file.size));
    hash.update("\0");
    hash.update(String(Math.floor(file.mtimeMs)));
    hash.update("\n");
  }
  return hash.digest("hex");
}

function groupDiscovered(records) {
  const groups = new Map();
  for (const record of records) {
    const name = record.name_guess || "unknown";
    const key = record.fingerprint ? `fp:${name}:${record.fingerprint}` : `path:${name}:${canonical(record.found_path)}`;
    if (!groups.has(key)) {
      groups.set(key, {
        name,
        key: `path:${canonical(record.found_path)}`,
        fingerprint: record.fingerprint,
        locations: [],
        imported: false,
        found_at: record.found_at,
      });
    }
    const group = groups.get(key);
    if (record.imported_skill_id) group.imported = true;
    if (record.found_at < group.found_at) group.found_at = record.found_at;
    group.locations.push({
      id: record.id,
      key: `path:${canonical(record.found_path)}`,
      tool: record.tool,
      found_path: record.found_path,
    });
  }
  for (const group of groups.values()) {
    group.locations.sort((a, b) => a.key.localeCompare(b.key));
    group.key = group.locations[0]?.key ?? group.key;
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function sourceDefinitions(store) {
  const tools = [];
  for (const tool of store.tools()) {
    if (!tool.installed && !tool.is_custom) continue;
    tools.push({
      key: `tool:${tool.key}`,
      kind: "tool",
      label: tool.display_name || tool.key,
      tool: tool.key,
      path: tool.skills_dir,
      recursive: !!tool.recursive_scan,
      include_root: false,
    });
  }
  const custom = discoveryDirectories(store).map(directory => ({
    key: `discovery:${canonical(directory)}`,
    kind: "discovery",
    label: path.basename(directory) || directory,
    tool: CUSTOM_DISCOVERY_TOOL,
    path: directory,
    recursive: true,
    include_root: true,
  }));
  return [...tools, ...custom];
}

// 只看目录结构，不跟随符号链接递归；junction 也会被 Dirent.isSymbolicLink() 识别。
function scanRoot(source, centralSkills) {
  const errors = [];
  const candidates = [];
  let rootStat;
  try { rootStat = fs.statSync(source.path); }
  catch (error) {
    if (source.kind === "discovery") errors.push({ path: source.path, message: `发现目录不可访问（${errorText(error)}）` });
    return { candidates, errors, readable: false, fatal: source.kind === "discovery" };
  }
  if (!rootStat.isDirectory()) {
    if (source.kind === "discovery") errors.push({ path: source.path, message: "发现目录不是有效目录" });
    return { candidates, errors, readable: false, fatal: source.kind === "discovery" };
  }
  if (source.include_root && isSkillDir(source.path)) {
    return { candidates: [source.path], errors, readable: true, fatal: false };
  }

  const visited = new Set([canonical(source.path)]);
  let rootReadFailed = false;
  const walk = (directory, depth) => {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
    catch (error) {
      if (directory === source.path) rootReadFailed = true;
      errors.push({ path: directory, message: `无法读取目录（${errorText(error)}）` });
      return;
    }
    for (const entry of entries) {
      if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
      const full = path.join(directory, entry.name);
      const link = entry.isSymbolicLink();
      if (!entry.isDirectory() && !link) continue;
      if (linksIntoCentral(full, centralSkills)) continue;
      if (link) {
        // 链接指向技能自身目录时可以作为候选；永不递归，避免环路。
        if (isSkillDir(full)) candidates.push(full);
        continue;
      }
      if (isSkillDir(full)) { candidates.push(full); continue; }
      if (!source.recursive || depth >= MAX_SCAN_DEPTH) continue;
      const real = canonical(full);
      if (visited.has(real)) continue;
      visited.add(real);
      walk(full, depth + 1);
    }
  };
  walk(source.path, 0);
  return { candidates, errors, readable: !rootReadFailed, fatal: rootReadFailed };
}

function inspectCandidate(directory, source, previousByPath) {
  const pathKey = canonical(directory);
  const previous = previousByPath.get(pathKey);
  let stat;
  try { stat = fs.statSync(directory); }
  catch (error) {
    return { error: { path: directory, message: `无法读取技能目录（${errorText(error)}）` } };
  }
  let signature = null;
  let fingerprint = previous?.fingerprint ?? null;
  let hashError = null;
  try {
    const listing = files(directory);
    signature = listingSignature(listing);
    if (!previous?.fingerprint || previous?.stat_signature !== signature) {
      fingerprint = hashDirectory(directory, listing);
    }
  } catch (error) {
    hashError = { path: directory, message: `无法计算内容指纹（${errorText(error)}）` };
  }
  return {
    record: {
      id: crypto.randomUUID(),
      source_key: source.key,
      tool: source.tool,
      found_path: directory,
      name_guess: metadata(directory).name || path.basename(directory),
      fingerprint,
      stat_signature: signature,
      found_at: stat.mtimeMs,
      imported_skill_id: null,
    },
    error: hashError,
  };
}

function removedSkillError(message) {
  return { source_key: "scan", source_path: null, path: null, message };
}

export function scanCommands(store, library) {
  let inFlight = null;

  function lastGoodResult(error) {
    let rows = [];
    try { rows = store.all("SELECT * FROM discovered_skills"); } catch { rows = []; }
    return {
      status: "failed",
      scanned_at: Date.now(),
      tools_scanned: 0,
      discovery_dirs_scanned: 0,
      skills_found: rows.length,
      groups: groupDiscovered(rows),
      sources: [],
      errors: [removedSkillError(error?.message || String(error))],
    };
  }

  function scanAll() {
    const centralSkills = store.skillsDirectory;
    const managed = new Set([
      ...store.all("SELECT target_path FROM skill_targets").map(row => canonical(row.target_path)),
      ...store.skills().map(skill => canonical(skill.central_path)),
    ]);
    const previousRows = store.all("SELECT * FROM discovered_skills");
    const previousByPath = new Map();
    for (const row of previousRows) previousByPath.set(canonical(row.found_path), row);

    const definitions = sourceDefinitions(store);
    const seenPaths = new Set();
    const results = definitions.map(source => {
      const { candidates, errors, readable, fatal } = scanRoot(source, centralSkills);
      const records = [];
      for (const directory of candidates) {
        const pathKey = canonical(directory);
        if (seenPaths.has(pathKey)) continue;
        seenPaths.add(pathKey);
        if (managed.has(pathKey)) continue;
        const inspected = inspectCandidate(directory, source, previousByPath);
        if (inspected.error) errors.push(inspected.error);
        if (inspected.record) records.push(inspected.record);
      }
      const status = fatal || (!readable && errors.length) ? "error" : errors.length ? "partial" : "ok";
      return { source, records, errors, status };
    });

    const errors = results.flatMap(result => result.errors.map(error => ({
      source_key: result.source.key,
      source_path: result.source.path,
      path: error.path ?? null,
      message: error.message,
    })));
    const failedSources = results.filter(result => result.status === "error");
    const status = results.length > 0 && failedSources.length === results.length
      ? "failed"
      : results.some(result => result.status !== "ok") ? "partial" : "ok";

    if (status !== "failed") {
      const committed = [];
      const committedPaths = new Set();
      for (const result of results) {
        const keepPrevious = result.status !== "ok";
        const records = [...result.records];
        if (keepPrevious) {
          for (const row of previousRows) {
            if (row.source_key !== result.source.key) continue;
            const pathKey = canonical(row.found_path);
            if (committedPaths.has(pathKey) || records.some(record => canonical(record.found_path) === pathKey)) continue;
            records.push({
              id: row.id,
              source_key: row.source_key,
              tool: row.tool,
              found_path: row.found_path,
              name_guess: row.name_guess,
              fingerprint: row.fingerprint,
              stat_signature: row.stat_signature,
              found_at: row.found_at,
              imported_skill_id: null,
            });
          }
        }
        for (const record of records) {
          const pathKey = canonical(record.found_path);
          if (committedPaths.has(pathKey)) continue;
          committedPaths.add(pathKey);
          committed.push(record);
        }
      }

      store.transaction(() => {
        store.run("DELETE FROM discovered_skills");
        for (const record of committed) {
          store.run("INSERT INTO discovered_skills(id,tool,found_path,name_guess,fingerprint,found_at,source_key,stat_signature) VALUES(?,?,?,?,?,?,?,?)",
            record.id, record.tool, record.found_path, record.name_guess, record.fingerprint, record.found_at, record.source_key, record.stat_signature);
        }
      });
      const skills = store.skills();
      for (const record of committed) {
        const match = record.fingerprint ? skills.find(skill => skill.content_hash === record.fingerprint) : null;
        if (match) store.run("UPDATE discovered_skills SET imported_skill_id=? WHERE id=?", match.id, record.id);
      }
    }

    const rows = store.all("SELECT * FROM discovered_skills");
    return {
      status,
      scanned_at: Date.now(),
      tools_scanned: results.filter(result => result.source.kind === "tool").length,
      discovery_dirs_scanned: results.filter(result => result.source.kind === "discovery" && result.status !== "error").length,
      skills_found: rows.length,
      groups: groupDiscovered(rows),
      sources: results.map(result => ({
        key: result.source.key,
        kind: result.source.kind,
        label: result.source.label,
        path: result.source.path,
        status: result.status,
        error: result.errors[0]?.message ?? null,
        found: result.records.length,
      })),
      errors,
    };
  }

  function scanLocalSkills() {
    if (inFlight) return inFlight;
    inFlight = Promise.resolve()
      .then(scanAll)
      .catch(error => lastGoodResult(error))
      .finally(() => { inFlight = null; });
    return inFlight;
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
    get_local_discovery_dirs: { call: () => listDiscoveryDirectories(store) },
    add_local_discovery_dir: { call: args => addDiscoveryDirectory(store, args.path) },
    remove_local_discovery_dir: { call: args => removeDiscoveryDirectory(store, args.path) },
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
