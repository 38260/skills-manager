import fs from "node:fs";
import path from "node:path";
import { metadata, hashDirectory, files, canonical, inside } from "./files.mjs";
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
    const modified = fs.statSync(file.full).mtimeMs;
    if (latest === null || modified > latest) latest = modified;
  }
  return latest;
}

// 递归读取一个技能根目录：识别含 SKILL.md 的目录，跳过隐藏目录与嵌入的 bundle skills 子树。
export function readSkillsRoot(root, { enabled, agent, agentDisplayName, recursive = true }) {
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
        skills.push({
          name: info.name || entry.name, dir_name: entry.name, relative_path: relative,
          description: info.description, author: info.author, author_source: info.author_source,
          path: full, files: listTopLevelFiles(full), enabled, agent, agent_display_name: agentDisplayName,
          tags: [], in_center: false, sync_status: "project_only", center_skill_id: null,
          content_hash: hashDirectory(full), last_modified_at: latestModifiedMs(full),
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

function matchesBySourceRef(managed, skillPath) {
  if (!managed.source_ref) return false;
  if (managed.source_ref === skillPath) return true;
  try { return canonical(managed.source_ref) === canonical(skillPath); } catch { return false; }
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
  const byRef = managedSkills.filter(skill => matchesBySourceRef(skill, info.path));
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

export function withCenterState(skills, store) {
  const managedSkills = store.skills();
  const tagsMap = new Map(managedSkills.map(skill => [skill.id, skill.tags]));
  const liveHashes = new Map();
  const liveHash = directory => {
    if (!liveHashes.has(directory)) liveHashes.set(directory, hashDirectory(directory));
    return liveHashes.get(directory);
  };
  for (const info of skills) {
    const match = matchCenterSkill(info, managedSkills);
    info.in_center = !!match;
    info.center_skill_id = match?.id ?? null;
    info.tags = match ? tagsMap.get(match.id) ?? [] : [];
    info.sync_status = classifySyncStatus(info, match, liveHash);
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
      return withCenterState(readSkillsRoot(tool.skills_dir, { enabled: true, agent: tool.key, agent_display_name: tool.display_name }), store);
    } },
    get_global_local_skill_document: { call: args => {
      const tool = findTool(args.agent);
      const info = findSkill(readSkillsRoot(tool.skills_dir, { enabled: true, agent: tool.key, agent_display_name: tool.display_name }), args.skillRelativePath, args.agent);
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
