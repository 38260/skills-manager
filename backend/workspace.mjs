import fs from "node:fs";
import path from "node:path";
import { metadata, hashDirectory, files, canonical, inside, readJson, writeJson } from "./files.mjs";
import { slugify } from "./scan.mjs";

// 全局工作区与项目工作区共用的技能目录读取、中心匹配与同步状态判定。
// 同步状态五值语义与旧版一致：project_only / in_sync / project_newer / center_newer / diverged。

export function isSkillDir(directory) {
  return fs.existsSync(directory) && ["SKILL.md", "skill.md"].some(name => fs.existsSync(path.join(directory, name)));
}

function listTopLevelFiles(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true }).filter(item => item.isFile()).map(item => item.name).sort();
  } catch { return []; }
}

function latestModifiedMs(directory) {
  let latest = null;
  for (const file of files(directory)) {
    const modified = file.mtimeMs ?? fs.statSync(file.full).mtimeMs;
    if (latest === null || modified > latest) latest = modified;
  }
  return latest;
}

// 目录内容哈希的进程内缓存。
// 打开一次工作区，每个技能都要算内容指纹，而部署模式默认是 symlink/junction（本地副本与中心是
// 同一个物理目录），于是同一个目录会被反复整读：实测 claude_code 的 skills 根 23 个技能 / 857 个
// 文件 / 120MB，只哈希一遍就要 620ms，一次请求里要读两遍以上。
// 这里用「文件数 + 总字节 + mtime 的最大值/和」做前置指纹：指纹没变就直接复用上次的哈希
// （stat 一遍实测约 85ms，是整读的 1/7 左右）。外部改动会刷新 mtime，指纹随之失效。
// 注意：写入类操作（安装 / 同步 / 备份）不使用这个缓存，仍然现算，保证落盘判定用的是新鲜内容。
// 同一次扫描顺带给出最后修改时间，调用方不再为同一目录走第二遍 files()。
//
// 缓存同时落盘（{技能库目录}/workspace-directory-state.json）：112MB 的真实副本首次索引后，
// 重启再打开工作区只需 stat 一遍比对指纹，不再把内容整读一次。指纹含文件数/总字节/mtime，
// 文件增删改都会失效；最坏情况和进程内缓存一样，只是把"可能沿用的旧结果"延长到跨进程。
const DIRECTORY_STATE_CACHE_VERSION = 1;
const DIRECTORY_STATE_CACHE_LIMIT = 2000;
const directoryStateCache = new Map();
let directoryStateCacheFile = null;
let directoryStateCacheLoaded = false;
let directoryStatePersistTimer = null;

export function configureWorkspaceDirectoryCache(directory) {
  directoryStateCache.clear();
  directoryStateCacheLoaded = false;
  directoryStateCacheFile = directory ? path.join(directory, "workspace-directory-state.json") : null;
}

function loadDirectoryStateCache() {
  if (directoryStateCacheLoaded) return;
  directoryStateCacheLoaded = true;
  if (!directoryStateCacheFile) return;
  let data;
  try { data = readJson(directoryStateCacheFile, null); } catch { return; }
  if (!data || data.version !== DIRECTORY_STATE_CACHE_VERSION || !data.entries) return;
  for (const [key, entry] of Object.entries(data.entries)) {
    if (typeof entry?.fingerprint === "string" && typeof entry?.hash === "string") directoryStateCache.set(key, entry);
  }
}

function scheduleDirectoryStatePersist() {
  if (!directoryStateCacheFile || directoryStatePersistTimer) return;
  directoryStatePersistTimer = setTimeout(() => {
    directoryStatePersistTimer = null;
    while (directoryStateCache.size > DIRECTORY_STATE_CACHE_LIMIT) {
      directoryStateCache.delete(directoryStateCache.keys().next().value);
    }
    try {
      writeJson(directoryStateCacheFile, {
        version: DIRECTORY_STATE_CACHE_VERSION,
        entries: Object.fromEntries(directoryStateCache),
      });
    } catch { /* 缓存写失败不影响读取结果 */ }
  }, 1000);
}

function cachedDirectoryState(directory) {
  loadDirectoryStateCache();
  let canonicalPath;
  try { canonicalPath = canonical(directory); } catch { return { hash: hashDirectory(directory), lastModifiedAt: latestModifiedMs(directory) }; }
  let listing;
  try { listing = files(directory); } catch { return { hash: hashDirectory(directory), lastModifiedAt: null }; }
  let bytes = 0, maxMtime = 0, sumMtime = 0;
  for (const file of listing) {
    bytes += file.size;
    const modified = file.mtimeMs ?? 0;
    if (modified > maxMtime) maxMtime = modified;
    sumMtime += modified;
  }
  const fingerprint = `${listing.length}:${bytes}:${Math.round(maxMtime)}:${Math.round(sumMtime)}`;
  const lastModifiedAt = maxMtime || null;
  const cached = directoryStateCache.get(canonicalPath);
  if (cached && cached.fingerprint === fingerprint) return { hash: cached.hash, lastModifiedAt };
  const hash = hashDirectory(directory, listing);
  directoryStateCache.set(canonicalPath, { fingerprint, hash });
  scheduleDirectoryStatePersist();
  return { hash, lastModifiedAt };
}

export function cachedDirectoryHash(directory) {
  return cachedDirectoryState(directory).hash;
}

// 递归读取一个技能根目录：识别含 SKILL.md 的目录，跳过隐藏目录与嵌入的 bundle skills 子树。
// centerPaths 是中央库技能的物理目录集合：命中说明工作区副本就是中心本体（junction/symlink），
// 内容必然一致，不必整读目录算指纹，交给 withCenterState 按物理路径直判 in_sync。
export function readSkillsRoot(root, { enabled, agent, agent_display_name, agentDisplayName = agent_display_name ?? agent, recursive = true, includeSyncState = true, centerPaths = null }) {
  const skills = [];
  if (!fs.existsSync(root)) return skills;
  const visited = new Set();
  const walk = (current, depth) => {
    let canon;
    try { canon = canonical(current); } catch { return; }
    if (visited.has(canon)) return;
    visited.add(canon);
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (isSkillDir(full)) {
        const info = metadata(full);
        const relative = path.relative(root, full).split(path.sep).join("/");
        const linkedToCenter = includeSyncState && !!centerPaths?.has(canonical(full));
        const state = includeSyncState && !linkedToCenter ? cachedDirectoryState(full) : null;
        skills.push({
          name: info.name || entry.name, dir_name: entry.name, relative_path: relative,
          description: info.description, author: info.author, author_source: info.author_source,
          path: full, files: listTopLevelFiles(full), enabled, agent, agent_display_name: agentDisplayName,
          tags: [], in_center: false, sync_status: "project_only", center_skill_id: null,
          content_hash: state?.hash ?? null,
          last_modified_at: state?.lastModifiedAt ?? null,
        });
        continue;
      }
      if (!recursive || entry.isSymbolicLink()) continue;
      // 跳过嵌入的插件/缓存 bundle 布局（<bundle>/<version>/skills/<skill>）
      if (depth > 0 && fs.existsSync(path.join(full, "skills"))) continue;
      walk(full, depth + 1);
    }
  };
  walk(root, 0);
  return skills.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

function matchesBySourceRef(managed, skillPath, canonicalPath) {
  if (!managed.source_ref) return false;
  if (managed.source_ref === skillPath) return true;
  try { return cachedCanonical(managed.source_ref) === canonicalPath; } catch { return false; }
}

// canonical() 就是 realpathSync：匹配循环里按「每个已纳管技能 × 每个工作区技能」调用会形成
// 上千次系统调用（53 × 23 实测贡献数百毫秒）。路径在一次读取内不会变，按请求缓存即可
// （withCenterState 进入时重置，不跨请求复用）。
let canonicalCache = new Map();
function cachedCanonical(filename) {
  const key = filename;
  if (canonicalCache.has(key)) return canonicalCache.get(key);
  const value = canonical(filename);
  canonicalCache.set(key, value);
  return value;
}

function uniqueMatch(candidates, hash) {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  if (!hash) return null;
  const filtered = candidates.filter(skill => skill.content_hash === hash);
  return filtered.length === 1 ? filtered[0] : null;
}

// 中心匹配优先级：source_ref 直连 > 唯一内容指纹 > 中心目录名 > slug 化名称；后两者用指纹消歧。
export function matchCenterSkill(info, managedSkills) {
  const canonicalPath = cachedCanonical(info.path);
  const byRef = managedSkills.filter(skill => matchesBySourceRef(skill, info.path, canonicalPath));
  if (byRef.length === 1) return byRef[0];
  if (info.content_hash) {
    const byHash = managedSkills.filter(skill => skill.content_hash === info.content_hash);
    if (byHash.length === 1) return byHash[0];
  }
  const byDirName = managedSkills.filter(skill => path.basename(skill.central_path).toLowerCase() === info.dir_name.toLowerCase());
  const dirMatch = uniqueMatch(byDirName, info.content_hash);
  if (dirMatch) return dirMatch;
  const byName = managedSkills.filter(skill => slugify(skill.name).toLowerCase() === info.dir_name.toLowerCase());
  return uniqueMatch(byName, info.content_hash);
}

// 同步状态判定：优先比对工作区指纹与中心实时目录指纹（DB 列可能过期，不作为判据）；
// 不一致时用磁盘修改时间比较（1 秒阈值）。liveHash 缓存避免同一中心目录在一次读取中重复哈希。
export function classifySyncStatus(info, managed, liveHash) {
  if (!managed) return "project_only";
  if (info.content_hash && liveHash(managed.central_path) === info.content_hash) return "in_sync";
  if (info.last_modified_at === null) return "diverged";
  const centerModified = latestModifiedMs(managed.central_path);
  if (centerModified === null) return "diverged";
  const threshold = 1000;
  if (info.last_modified_at > centerModified + threshold) return "project_newer";
  if (centerModified > info.last_modified_at + threshold) return "center_newer";
  return "diverged";
}

export function withCenterState(skills, store, managedSkills = store?.skills() ?? []) {
  // canonical 缓存按「一次读取」为生命周期：路径可能被重链/卸载，跨请求不复用。
  canonicalCache = new Map();
  const tagsMap = new Map(managedSkills.map(skill => [skill.id, skill.tags]));
  // 工作区副本若就是中心本体（junction/symlink），物理路径一致即内容一致：
  // 直接判 in_sync，既不读工作区目录，也不读中心目录。这是冷启动最大的一块读盘。
  const centralByPath = new Map();
  for (const managed of managedSkills) centralByPath.set(cachedCanonical(managed.central_path), managed);
  // 按物理目录（canonical）缓存实时指纹，并且**先把 readSkillsRoot 已经算好的工作区指纹放进去**：
  // 非链接部署下，工作区副本与中心内容相同时也不再整读中心目录。
  const liveHashes = new Map();
  const liveHash = directory => {
    const key = cachedCanonical(directory);
    if (!liveHashes.has(key)) liveHashes.set(key, cachedDirectoryHash(directory));
    return liveHashes.get(key);
  };
  for (const info of skills) if (info.content_hash) liveHashes.set(cachedCanonical(info.path), info.content_hash);
  for (const info of skills) {
    const byPath = centralByPath.get(cachedCanonical(info.path)) ?? null;
    const match = byPath ?? matchCenterSkill(info, managedSkills);
    info.in_center = !!match;
    info.center_skill_id = match?.id ?? null;
    info.tags = match ? tagsMap.get(match.id) ?? [] : [];
    info.sync_status = byPath ? "in_sync" : classifySyncStatus(info, match, liveHash);
    delete info.content_hash;
    delete info.last_modified_at;
  }
  return skills;
}

// 用中心内容整体替换工作区副本（更新自中心）：目录级暂存交换，失败保持原内容。
export function replaceWorkspaceCopy(info, managed) {
  const parent = path.dirname(info.path);
  const staged = path.join(parent, `.update-${Date.now().toString(36)}`);
  const previous = path.join(parent, `.previous-${Date.now().toString(36)}`);
  try {
    fs.mkdirSync(staged, { recursive: true });
    for (const file of files(managed.central_path)) {
      const target = inside(staged, file.relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(file.full, target);
    }
    fs.renameSync(info.path, previous);
    try { fs.renameSync(staged, info.path); }
    catch (error) { fs.renameSync(previous, info.path); throw error; }
  } finally {
    if (fs.existsSync(previous)) fs.rmSync(previous, { recursive: true, force: true });
    if (fs.existsSync(staged)) fs.rmSync(staged, { recursive: true, force: true });
  }
}

export function workspaceCommands(store, library) {
  const findTool = key => {
    const tool = store.tools().find(item => item.key === key);
    if (!tool) throw new Error("工具不存在");
    return tool;
  };
  const findSkill = (skills, relativePath, agent) => {
    const info = skills.find(skill => skill.relative_path === relativePath && skill.agent === agent);
    if (!info) throw new Error("工作区中未找到该技能");
    return info;
  };

  return {
    get_global_local_skills: { call: args => {
      const tool = findTool(args.agent);
      const managedSkills = store.skills();
      const centerPaths = new Set(managedSkills.map(skill => canonical(skill.central_path)));
      return withCenterState(
        readSkillsRoot(tool.skills_dir, { enabled: true, agent: tool.key, agent_display_name: tool.display_name, centerPaths }),
        store,
        managedSkills
      );
    } },
    // 总览只需要数量；读取正文只需要身份与路径，均不计算同步指纹。
    get_global_local_skill_count: { call: args => {
      const tool = findTool(args.agent);
      return readSkillsRoot(tool.skills_dir, { enabled: true, agent: tool.key, includeSyncState: false }).length;
    } },
    get_global_local_skill_document: { call: args => {
      const tool = findTool(args.agent);
      const info = findSkill(readSkillsRoot(tool.skills_dir, { enabled: true, agent: tool.key, agent_display_name: tool.display_name, includeSyncState: false }), args.skillRelativePath, args.agent);
      const filename = ["SKILL.md", "skill.md"].find(name => fs.existsSync(path.join(info.path, name)));
      if (!filename) throw new Error("该目录没有 SKILL.md");
      return { skill_name: info.name, filename, content: fs.readFileSync(path.join(info.path, filename), "utf8") };
    } },
    delete_global_local_skill: { call: args => {
      const tool = findTool(args.agent);
      const info = findSkill(readSkillsRoot(tool.skills_dir, { enabled: true, agent: tool.key, agent_display_name: tool.display_name }), args.skillRelativePath, args.agent);
      // 保护：不允许删除（或删除到）任何已纳管技能的中心目录内容。
      const target = canonical(info.path);
      for (const skill of store.skills()) {
        const central = canonical(skill.central_path);
        if (target === central || target.startsWith(central + path.sep)) throw new Error("该目录指向技能库本体，请使用技能库的删除入口");
      }
      const stat = fs.lstatSync(info.path);
      if (stat.isSymbolicLink()) fs.unlinkSync(info.path);
      else fs.rmSync(info.path, { recursive: true, force: true });
    }, mutating: true },
    import_global_local_skill_to_center: { call: args => {
      const tool = findTool(args.agent);
      const info = findSkill(readSkillsRoot(tool.skills_dir, { enabled: true, agent: tool.key, agent_display_name: tool.display_name }), args.skillRelativePath, args.agent);
      const managedSkills = store.skills();
      const match = matchCenterSkill(info, managedSkills);
      if (match) return library.replaceWithDirectory(match.id, info.path);
      return library.install(info.path, { source_type: "local", source_ref: info.path });
    }, mutating: true },
    update_global_local_skill_from_center: { call: args => {
      const tool = findTool(args.agent);
      const info = findSkill(readSkillsRoot(tool.skills_dir, { enabled: true, agent: tool.key, agent_display_name: tool.display_name }), args.skillRelativePath, args.agent);
      const live = { ...info, content_hash: hashDirectory(info.path), last_modified_at: latestModifiedMs(info.path) };
      const match = matchCenterSkill(live, store.skills());
      if (!match) throw new Error("技能库中没有匹配的技能，请先导入到中心");
      if (fs.lstatSync(info.path).isSymbolicLink()) return; // 符号链接副本始终反映中心内容
      if (classifySyncStatus(live, match, directory => hashDirectory(directory)) === "project_newer") {
        throw new Error("工作区副本比技能库新，覆盖会丢失本地修改，请先导入到中心");
      }
      replaceWorkspaceCopy(info, match);
    }, mutating: true },
  };
}
