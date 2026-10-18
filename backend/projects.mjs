import fs from "node:fs";
import path from "node:path";
import { readSkillsRoot, withCenterState, matchCenterSkill, classifySyncStatus, replaceWorkspaceCopy } from "./workspace.mjs";
import { slugify } from "./scan.mjs";
import { inside, copySkill, canonical, hashDirectory } from "./files.mjs";

// 项目工作区命令：项目 CRUD、项目技能读取、导入导出与启用开关。
// 语义沿用旧版：project 类型按各工具的 project_relative_skills_dir 组织（含 -disabled 目录）；
// linked 类型把一个已有目录整体作为单一 Agent 的技能根。

const SYNC_STATUS_PRIORITY = { diverged: 5, project_newer: 4, center_newer: 3, project_only: 2, in_sync: 1 };

export function agentSkillConfigs(store) {
  const grouped = new Map();
  for (const tool of store.tools()) {
    const dir = tool.project_relative_skills_dir;
    if (!dir) continue;
    if (!grouped.has(dir)) grouped.set(dir, []);
    grouped.get(dir).push(tool);
  }
  return [...grouped.entries()].map(([dir, tools]) => ({
    relative_skills_dir: dir, key: tools[0].key,
    display_name: tools.map(tool => tool.display_name).join(" / "),
  }));
}

function linkedAgentKey(record) { return record.linked_agent_key || slugify(record.name); }
function linkedAgentName(record) { return record.linked_agent_name || record.name; }

function readWorkspaceSkills(record, store, includeSyncState = true) {
  if (record.workspace_type === "linked") {
    return readSkillsRoot(record.path, { enabled: true, agent: linkedAgentKey(record), agent_display_name: linkedAgentName(record), includeSyncState })
      .concat(record.disabled_path ? readSkillsRoot(record.disabled_path, { enabled: false, agent: linkedAgentKey(record), agent_display_name: linkedAgentName(record), includeSyncState }) : []);
  }
  const skills = [];
  for (const config of agentSkillConfigs(store)) {
    skills.push(...readSkillsRoot(path.join(record.path, config.relative_skills_dir), { enabled: true, agent: config.key, agent_display_name: config.display_name, includeSyncState }));
    skills.push(...readSkillsRoot(path.join(record.path, `${config.relative_skills_dir}-disabled`), { enabled: false, agent: config.key, agent_display_name: config.display_name, includeSyncState }));
  }
  return skills;
}

function resolveAgentRoots(store, record, agent) {
  if (record.workspace_type === "linked") {
    if (linkedAgentKey(record) !== agent) return null;
    return { skillsRoot: record.path, disabledRoot: record.disabled_path };
  }
  const tool = store.tools().find(item => item.key === agent);
  if (!tool || !tool.project_relative_skills_dir) return null;
  return { skillsRoot: path.join(record.path, tool.project_relative_skills_dir), disabledRoot: path.join(record.path, `${tool.project_relative_skills_dir}-disabled`) };
}

function agentTargets(record, store) {
  if (record.workspace_type === "linked") {
    return [{ key: linkedAgentKey(record), display_name: linkedAgentName(record), enabled: true, installed: true, is_custom: false }];
  }
  const disabled = new Set(store.settingJson("disabled_tools", []));
  return agentSkillConfigs(store).map(config => {
    const tool = store.tools().find(item => item.key === config.key);
    return { key: config.key, display_name: config.display_name, enabled: !disabled.has(config.key),
      installed: !!tool?.installed, is_custom: !!tool?.is_custom };
  });
}

function projectDto(record, store) {
  const skills = readWorkspaceSkills(record, store);
  const liveHashes = new Map();
  const liveHash = directory => {
    if (!liveHashes.has(directory)) liveHashes.set(directory, hashDirectory(directory));
    return liveHashes.get(directory);
  };
  const worst = new Map();
  for (const info of skills) {
    const match = matchCenterSkill(info, store.skills());
    const status = classifySyncStatus(info, match, liveHash);
    const key = info.relative_path.toLowerCase();
    if (!worst.has(key) || (SYNC_STATUS_PRIORITY[status] ?? 0) > (SYNC_STATUS_PRIORITY[worst.get(key)] ?? 0)) worst.set(key, status);
  }
  const health = { in_sync: 0, project_newer: 0, center_newer: 0, diverged: 0, project_only: 0 };
  for (const status of worst.values()) health[status in health ? status : "project_only"]++;
  return {
    id: record.id, name: record.name, path: record.path, workspace_type: record.workspace_type,
    linked_agent_name: record.linked_agent_name,
    supports_skill_toggle: record.workspace_type !== "linked" || !!record.disabled_path,
    sort_order: record.sort_order, skill_count: worst.size, sync_health: health,
    created_at: record.created_at, updated_at: record.updated_at,
  };
}

function ensureSafeRelative(relativePath) {
  const normalized = String(relativePath ?? "").replace(/\\/g, "/");
  if (!normalized || normalized.split("/").some(part => !part || part === "." || part === ".." || part.startsWith("."))) {
    throw new Error("无效的技能相对路径");
  }
  return normalized;
}

// 词法包含检查（不用 realpath）：junction/symlink 的目标是外部目录是合法状态，
// 移动或删除链接本身不触碰目标；路径穿越已由 ensureSafeRelative 阻止。
function ensureInside(target, root) {
  const norm = value => {
    const resolved = path.resolve(value).replace(/[\\/]+$/, "");
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const inner = norm(target), outer = norm(root);
  if (inner !== outer && !inner.startsWith(outer + path.sep)) throw new Error("路径超出工作区范围");
  return target;
}

function removeEntry(target) {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) fs.unlinkSync(target);
  else fs.rmSync(target, { recursive: true, force: true });
}

// 自下而上清理因移动/删除产生的空父目录，直到工作区技能根。
function cleanupEmptyDirs(start, root) {
  let current = start;
  for (;;) {
    if (canonical(current) === canonical(root)) return;
    try { fs.rmdirSync(current); } catch { return; }
    current = path.dirname(current);
    if (!canonical(current).startsWith(canonical(root))) return;
  }
}

function setEnabledState(skillsRoot, disabledRoot, relativePath, enabled) {
  const enabledPath = ensureInside(path.join(skillsRoot, relativePath), skillsRoot);
  const disabledPath = ensureInside(path.join(disabledRoot, relativePath), disabledRoot);
  if (enabled) {
    if (fs.existsSync(enabledPath)) {
      if (fs.existsSync(disabledPath)) removeEntry(disabledPath);
      return;
    }
    if (!fs.existsSync(disabledPath)) throw new Error("在 skills-disabled 中未找到该技能目录");
    fs.mkdirSync(path.dirname(enabledPath), { recursive: true });
    fs.renameSync(disabledPath, enabledPath);
    cleanupEmptyDirs(path.dirname(disabledPath), disabledRoot);
    return;
  }
  if (fs.existsSync(disabledPath)) return;
  if (!fs.existsSync(enabledPath)) throw new Error("未找到该技能目录");
  fs.mkdirSync(path.dirname(disabledPath), { recursive: true });
  fs.renameSync(enabledPath, disabledPath);
  cleanupEmptyDirs(path.dirname(enabledPath), skillsRoot);
}

export function projectCommands(store, library) {
  const requireProject = id => store.project(id);
  const requireSkillInfo = (record, relativePath, agent, includeSyncState = true) => {
    const info = readWorkspaceSkills(record, store, includeSyncState).find(skill => skill.relative_path === relativePath && skill.agent === agent);
    if (!info) throw new Error("工作区中未找到该技能");
    return info;
  };

  return {
    get_projects: { call: () => store.projects().map(record => projectDto(record, store)) },
    add_project: { call: args => {
      const projectPath = path.resolve(String(args.path ?? ""));
      if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) throw new Error("目录不存在");
      fs.mkdirSync(path.join(projectPath, ".claude", "skills"), { recursive: true });
      fs.mkdirSync(path.join(projectPath, ".claude", "skills-disabled"), { recursive: true });
      return projectDto(store.insertProject({ name: path.basename(projectPath), projectPath }), store);
    }, mutating: true },
    add_linked_workspace: { call: args => {
      const name = String(args.name ?? "").trim();
      const skillsRoot = path.resolve(String(args.path ?? "").trim());
      if (!name) throw new Error("工作区名称不能为空");
      if (!fs.existsSync(skillsRoot) || !fs.statSync(skillsRoot).isDirectory()) throw new Error("技能目录不存在");
      let disabledPath = null;
      const requested = String(args.disabledPath ?? "").trim();
      if (requested) {
        if (!fs.existsSync(requested) || !fs.statSync(requested).isDirectory()) throw new Error("停用技能目录不存在");
        const same = value => canonical(value) === canonical(skillsRoot)
          || canonical(value).startsWith(canonical(skillsRoot) + path.sep)
          || canonical(skillsRoot).startsWith(canonical(value) + path.sep);
        if (same(requested)) throw new Error("技能目录与停用目录不能互相重叠");
        disabledPath = requested;
      }
      return projectDto(store.insertProject({ name, projectPath: skillsRoot, workspaceType: "linked",
        linkedAgentKey: slugify(name), linkedAgentName: name, disabledPath }), store);
    }, mutating: true },
    remove_project: { call: args => { requireProject(args.id); store.removeProject(args.id); }, mutating: true },
    reorder_projects: { call: args => store.reorderProjects(Array.isArray(args.ids) ? args.ids : []), mutating: true },
    scan_projects: { call: args => {
      const root = path.resolve(String(args.root ?? ""));
      if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error("目录不存在");
      const configs = agentSkillConfigs(store);
      const found = [];
      const walk = (current, depth) => {
        if (configs.some(config => fs.existsSync(path.join(current, config.relative_skills_dir)))) { found.push(current); return; }
        if (depth >= 4) return;
        let entries;
        try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith(".") || ["node_modules", "target", "__pycache__"].includes(entry.name)) continue;
          walk(path.join(current, entry.name), depth + 1);
        }
      };
      walk(root, 0);
      return found.sort();
    } },
    get_project_agent_targets: { call: args => agentTargets(requireProject(args.projectId), store) },
    get_project_skills: { call: args => withCenterState(readWorkspaceSkills(requireProject(args.projectId), store), store) },
    get_project_skill_document: { call: args => {
      const info = requireSkillInfo(requireProject(args.projectId), args.skillRelativePath, args.agent, false);
      const filename = ["SKILL.md", "skill.md"].find(name => fs.existsSync(path.join(info.path, name)));
      if (!filename) throw new Error("该目录没有 SKILL.md");
      return { skill_name: info.name, filename, content: fs.readFileSync(path.join(info.path, filename), "utf8") };
    } },
    delete_project_skill: { call: args => {
      const record = requireProject(args.projectId);
      const relativePath = ensureSafeRelative(args.skillRelativePath);
      const roots = resolveAgentRoots(store, record, args.agent);
      if (!roots) throw new Error("未知的工作区 Agent");
      const enabledPath = path.join(roots.skillsRoot, relativePath);
      const disabledPath = roots.disabledRoot ? path.join(roots.disabledRoot, relativePath) : null;
      const target = fs.existsSync(enabledPath) ? enabledPath
        : disabledPath && fs.existsSync(disabledPath) ? disabledPath : null;
      if (!target) throw new Error("未找到该技能目录");
      removeEntry(ensureInside(target, target.startsWith(roots.skillsRoot) ? roots.skillsRoot : roots.disabledRoot));
      cleanupEmptyDirs(path.dirname(target), target.startsWith(roots.skillsRoot) ? roots.skillsRoot : roots.disabledRoot);
    }, mutating: true },
    toggle_project_skill: { call: args => {
      const record = requireProject(args.projectId);
      if (record.workspace_type === "linked" && !record.disabled_path) throw new Error("该工作区不支持停用技能");
      const relativePath = ensureSafeRelative(args.skillRelativePath);
      const roots = resolveAgentRoots(store, record, args.agent);
      if (!roots) throw new Error("未知的工作区 Agent");
      if (!roots.disabledRoot) throw new Error("该工作区不支持停用技能");
      setEnabledState(roots.skillsRoot, roots.disabledRoot, relativePath, !!args.enabled);
    }, mutating: true },
    import_project_skill_to_center: { call: args => {
      const record = requireProject(args.projectId);
      const info = requireSkillInfo(record, args.skillRelativePath, args.agent);
      const match = matchCenterSkill(info, store.skills());
      if (match) return library.replaceWithDirectory(match.id, info.path);
      return library.install(info.path, { source_type: "local", source_ref: info.path });
    }, mutating: true },
    update_project_skill_to_center: { call: args => {
      const record = requireProject(args.projectId);
      const info = requireSkillInfo(record, args.skillRelativePath, args.agent);
      const match = matchCenterSkill(info, store.skills());
      if (match) return library.replaceWithDirectory(match.id, info.path);
      return library.install(info.path, { source_type: "local", source_ref: info.path });
    }, mutating: true },
    update_project_skill_from_center: { call: args => {
      const record = requireProject(args.projectId);
      const info = requireSkillInfo(record, args.skillRelativePath, args.agent);
      const match = matchCenterSkill(info, store.skills());
      if (!match) throw new Error("技能库中没有匹配的技能，请先导入到中心");
      if (fs.lstatSync(info.path).isSymbolicLink()) return;
      if (classifySyncStatus(info, match, directory => hashDirectory(directory)) === "project_newer") {
        throw new Error("项目副本比技能库新，覆盖会丢失本地修改，请先推送到中心");
      }
      replaceWorkspaceCopy(info, match);
    }, mutating: true },
    export_skill_to_project: { call: args => {
      const record = requireProject(args.projectId);
      const skill = store.skill(args.skillId);
      const dirName = path.basename(skill.central_path);
      const requested = Array.isArray(args.agents) && args.agents.length ? args.agents : ["claude_code"];
      let agentKeys = requested;
      if (record.workspace_type !== "linked") {
        const available = new Set(agentTargets(record, store).filter(target => target.installed && target.enabled).map(target => target.key));
        agentKeys = requested.filter(key => available.has(key));
        if (!agentKeys.length) throw new Error("所选 Agent 在该项目中不可用（未安装或已停用）");
      }
      // 先检查全部目标，任一冲突整体拒绝；两个 Agent 共享同一目录时只写一次。
      const rootsList = agentKeys.map(key => {
        const roots = resolveAgentRoots(store, record, key);
        if (!roots) throw new Error(`未知的工作区 Agent：${key}`);
        return roots;
      });
      const written = new Set();
      for (const roots of rootsList) {
        const target = inside(roots.skillsRoot, dirName);
        if (fs.existsSync(target) || (roots.disabledRoot && fs.existsSync(path.join(roots.disabledRoot, dirName)))) {
          throw new Error(`技能 "${skill.name}" 已存在于该项目对应 Agent 的目录中`);
        }
        if (!written.has(canonical(roots.skillsRoot))) written.add(canonical(roots.skillsRoot));
        else continue;
        fs.mkdirSync(roots.skillsRoot, { recursive: true });
        const mode = store.getSetting("sync_mode") || "symlink";
        if (mode === "copy") copySkill(skill.central_path, target);
        else fs.symlinkSync(skill.central_path, target, process.platform === "win32" ? "junction" : "dir");
      }
    }, mutating: true },
  };
}
