import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readJson, writeJson, inside, metadata, hashDirectory, canonical } from "./files.mjs";

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
const definitions = readJson(new URL("./agents.json", import.meta.url));
const sensitive = key => ["proxy_url", "git_backup_remote_url"].includes(key) || key.startsWith("credential:");

export class Store {
  constructor({ directory, home = os.homedir() } = {}) {
    this.home = path.resolve(home);
    this.defaultDirectory = directory ? path.resolve(directory) : path.join(this.home, ".skills-manager");
    const config = directory ? null : readJson(path.join(this.defaultDirectory, "repo-config.json"), {});
    this.configFile = path.join(this.defaultDirectory, "repo-config.json");
    this.startupWarnings = [];
    this.repoPathOverride = null;
    let repoPath = config?.repo_path ?? null;
    // 重启时晋升待生效路径：创建失败则回退并记录警告，不阻断启动。
    if (!directory && config?.pending_repo_path) {
      const pending = path.resolve(String(config.pending_repo_path));
      try {
        if (pending === path.parse(pending).root) throw new Error("技能库必须使用专用目录");
        fs.mkdirSync(path.join(pending, "skills"), { recursive: true });
        repoPath = pending;
      } catch (error) {
        this.startupWarnings.push(`技能库路径 ${pending} 无法使用（${error.message}），已回退到原路径`);
      }
      this.writeRepoConfig({ repo_path: repoPath ?? undefined, pending_repo_path: null });
    }
    this.pendingRepoPath = null;
    if (repoPath) {
      try {
        if (path.resolve(repoPath) !== path.parse(path.resolve(repoPath)).root) this.repoPathOverride = path.resolve(repoPath);
      } catch { this.repoPathOverride = null; }
    }
    this.directory = path.resolve(repoPath || this.defaultDirectory);
    if (this.directory === path.parse(this.directory).root) throw new Error("技能库必须使用专用目录");
    fs.mkdirSync(this.directory, { recursive: true });
    this.skillsDirectory = path.join(this.directory, "skills");
    fs.mkdirSync(this.skillsDirectory, { recursive: true });
    this.db = new DatabaseSync(path.join(this.directory, "skills-manager.db"), { timeout: 5000 });
    const version = this.db.prepare("PRAGMA user_version").get().user_version;
    if (version > 8) { this.db.close(); throw new Error("数据库版本较新，请使用兼容的应用版本"); }
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
    this.db.exec(schema);
    for (const [table, name, definition] of [
      ["scenario_skills", "sort_order", "INTEGER DEFAULT 0"],
      ["scenarios", "icon", "TEXT"],
      ["projects", "workspace_type", "TEXT NOT NULL DEFAULT 'project'"],
      ["projects", "linked_agent_key", "TEXT"], ["projects", "linked_agent_name", "TEXT"], ["projects", "disabled_path", "TEXT"],
      ["skill_targets", "source_hash", "TEXT"],
      // 扫描缓存：来源标识用于部分失败时保留上一轮结果；stat_signature 用于避免每次重读全部文件内容。
      ["discovered_skills", "source_key", "TEXT"], ["discovered_skills", "stat_signature", "TEXT"],
      // 用户自定义展示信息：别名、自定义说明、作者覆盖、logo；不改动技能文件本身。
      ["skills", "alias", "TEXT"], ["skills", "custom_description", "TEXT"], ["skills", "author_override", "TEXT"],
      ["skills", "icon", "TEXT"],
    ]) {
      if (!this.all(`PRAGMA table_info(${table})`).some(column => column.name === name)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
    this.db.exec("PRAGMA user_version=8;");
    const keyFile = path.join(this.directory, ".secret.key");
    if (!fs.existsSync(keyFile)) {
      if (this.get("SELECT key FROM settings WHERE value LIKE 'enc:v1:%' LIMIT 1")) throw new Error("加密密钥缺失，原有配置未改动");
      fs.writeFileSync(keyFile, crypto.randomBytes(32), { mode: 0o600, flag: "wx" });
    }
    this.key = fs.readFileSync(keyFile);
    if (this.key.length !== 32) throw new Error("加密密钥损坏，原有配置未改动");
    this.reindexMetadata();
    if (!this.get("SELECT id FROM scenarios LIMIT 1")) this.run(
      "INSERT INTO scenarios(id,name,description,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      crypto.randomUUID(), "Default", null, 0, Date.now(), Date.now());
  }

  all(sql, ...values) { return this.db.prepare(sql).all(...values.map(value => typeof value === "boolean" ? Number(value) : value ?? null)).map(row => ({ ...row })); }
  get(sql, ...values) { return this.all(sql, ...values)[0] ?? null; }
  run(sql, ...values) { return this.db.prepare(sql).run(...values.map(value => typeof value === "boolean" ? Number(value) : value ?? null)); }
  transaction(action) {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = action(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  close() { this.db.close(); }

  writeRepoConfig(patch) {
    const current = readJson(this.configFile, {});
    const next = { ...current, ...patch };
    for (const key of Object.keys(next)) if (next[key] === undefined || next[key] === null) delete next[key];
    writeJson(this.configFile, next);
  }
  // 保存新的技能库路径：写入待生效路径，重启时晋升；null 表示重置覆盖。
  setCentralRepoPath(value) {
    if (value === null || String(value).trim() === "") {
      this.writeRepoConfig({ repo_path: null, pending_repo_path: null });
      this.pendingRepoPath = null;
      return null;
    }
    const target = path.resolve(String(value).trim());
    if (target === path.parse(target).root) throw new Error("技能库必须使用专用目录");
    if (canonical(target) === canonical(this.directory)) throw new Error("新路径与当前技能库路径相同");
    this.writeRepoConfig({ pending_repo_path: target });
    this.pendingRepoPath = target;
    return this.repoPathOverride ?? target;
  }

  getSetting(key) {
    const value = this.get("SELECT value FROM settings WHERE key=?", key)?.value ?? null;
    if (!value?.startsWith("enc:v1:")) return value;
    const hex = value.slice(7);
    if (!/^[a-f0-9]+$/i.test(hex) || hex.length % 2 || hex.length < 56) throw new Error("加密配置格式无效");
    const bytes = Buffer.from(hex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString("utf8");
  }
  setSetting(key, value) {
    let saved = String(value);
    if (sensitive(key)) {
      const nonce = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", this.key, nonce);
      const encrypted = Buffer.concat([cipher.update(saved, "utf8"), cipher.final()]);
      saved = "enc:v1:" + Buffer.concat([nonce, encrypted, cipher.getAuthTag()]).toString("hex");
    }
    this.run("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, saved);
  }
  settingJson(key, fallback) { const value = this.getSetting(key); return value === null ? fallback : JSON.parse(value); }

  categories() {
    return [...new Set([...this.settingJson("skill_categories", ["UI", "自定义"]), ...this.all("SELECT DISTINCT tag FROM skill_tags").map(row => row.tag)])].sort();
  }
  createCategory(name) {
    name = String(name).trim(); if (!name) throw new Error("分类名称不能为空");
    this.setSetting("skill_categories", JSON.stringify([...new Set([...this.categories(), name])]));
  }
  renameCategory(oldName, newName) {
    newName = String(newName).trim(); if (!newName) throw new Error("分类名称不能为空");
    if (oldName === newName) return;
    const affected = this.all("SELECT skill_id FROM skill_tags WHERE tag=?", oldName);
    this.transaction(() => {
      const catalog = this.categories().map(name => name === oldName ? newName : name);
      this.run("UPDATE OR IGNORE skill_tags SET tag=? WHERE tag=?", newName, oldName);
      this.run("DELETE FROM skill_tags WHERE tag=?", oldName);
      this.setSetting("skill_categories", JSON.stringify([...new Set(catalog)].sort()));
    });
    affected.forEach(row => this.saveMetadata(row.skill_id));
  }
  deleteCategory(name) {
    const affected = this.all("SELECT skill_id FROM skill_tags WHERE tag=?", name);
    this.transaction(() => {
      const catalog = this.categories().filter(value => value !== name);
      this.run("DELETE FROM skill_tags WHERE tag=?", name);
      this.setSetting("skill_categories", JSON.stringify(catalog));
    });
    affected.forEach(row => this.saveMetadata(row.skill_id));
  }
  tags(id) { return this.all("SELECT tag FROM skill_tags WHERE skill_id=? ORDER BY tag", id).map(row => row.tag); }
  setTags(id, tags) {
    if (!this.get("SELECT id FROM skills WHERE id=?", id)) throw new Error("技能不存在");
    this.transaction(() => {
      this.run("DELETE FROM skill_tags WHERE skill_id=?", id);
      for (const tag of new Set(tags.map(value => String(value).trim()).filter(Boolean))) this.run("INSERT INTO skill_tags(skill_id,tag) VALUES(?,?)", id, tag);
    });
    this.saveMetadata(id);
  }

  skillFromRow(row) {
    const meta = metadata(row.central_path);
    // 用户自定义信息优先于技能文件里的元数据，但两者都返回，便于界面标注来源。
    const alias = row.alias || null, customDescription = row.custom_description || null, authorOverride = row.author_override || null;
    return { ...row, enabled: !!row.enabled, description: meta.description || row.description,
      author: meta.author, author_source: meta.author_source,
      alias, custom_description: customDescription, author_override: authorOverride,
      display_name: alias || row.name,
      display_description: customDescription || meta.description || row.description || null,
      display_author: authorOverride || meta.author,
      display_author_source: authorOverride ? "custom" : meta.author_source,
      tags: this.tags(row.id), targets: this.all("SELECT * FROM skill_targets WHERE skill_id=?", row.id),
      preset_ids: this.all("SELECT scenario_id FROM scenario_skills WHERE skill_id=?", row.id).map(item => item.scenario_id) };
  }
  // 保存用户自定义展示信息；空字符串表示清除该项，回退到技能文件里的值。
  setProfile(id, { alias, customDescription, authorOverride, icon } = {}) {
    if (!this.get("SELECT id FROM skills WHERE id=?", id)) throw new Error("技能不存在");
    const clean = value => { const text = String(value ?? "").trim(); return text ? text.slice(0, 500) : null; };
    this.run("UPDATE skills SET alias=?, custom_description=?, author_override=?, icon=? WHERE id=?",
      clean(alias), clean(customDescription), clean(authorOverride), clean(icon)?.slice(0, 48) ?? null, id);
    this.saveMetadata(id);
    return this.skill(id);
  }
  skills() {
    return this.all("SELECT * FROM skills ORDER BY name").map(row => this.skillFromRow(row));
  }
  // 按 id 只取一行。旧实现是「重建整张技能表再 find」，在逐技能循环里会退化成 O(N²)：
  // 实测 52 个技能逐个检查更新要 41ms/个，其中绝大部分是重复重建（每次读 53 个 SKILL.md + 上百条查询）。
  skill(id) {
    const row = this.get("SELECT * FROM skills WHERE id=?", id);
    if (!row) throw new Error("技能不存在");
    return this.skillFromRow(row);
  }
  skillsForPreset(id) {
    return this.all("SELECT s.* FROM skills s JOIN scenario_skills ss ON ss.skill_id=s.id WHERE ss.scenario_id=? ORDER BY s.name", id).map(row => this.skillFromRow(row));
  }
  skillInPreset(presetId, skillId) {
    return !!this.get("SELECT 1 FROM scenario_skills WHERE scenario_id=? AND skill_id=?", presetId, skillId);
  }
  addSkillToPreset(skillId, presetId) {
    if (!this.get("SELECT id FROM skills WHERE id=?", skillId)) throw new Error("技能不存在");
    if (!this.get("SELECT id FROM scenarios WHERE id=?", presetId)) throw new Error("Preset 不存在");
    this.transaction(() => {
      this.run("INSERT OR IGNORE INTO scenario_skills(scenario_id,skill_id,added_at) VALUES(?,?,?)", presetId, skillId, Date.now());
      this.savePresets();
    });
  }
  removeSkillFromPreset(skillId, presetId) {
    if (!this.get("SELECT id FROM skills WHERE id=?", skillId)) throw new Error("技能不存在");
    if (!this.get("SELECT id FROM scenarios WHERE id=?", presetId)) throw new Error("Preset 不存在");
    this.transaction(() => {
      this.run("DELETE FROM scenario_skills WHERE scenario_id=? AND skill_id=?", presetId, skillId);
      this.savePresets();
    });
  }
  // 「活动 Preset」概念已随 v1.16 的 applyPreset 一起废弃，此表恒为空；
  // 保留读取方法是因为 sync_skill_to_tool 等仍用它做「存在活动 Preset 时才同步开关」的防御判断。
  activeScenarioId() { return this.get("SELECT scenario_id FROM active_scenario WHERE key='current'")?.scenario_id ?? null; }

  // ── 项目工作区 ──
  projects() { return this.all("SELECT * FROM projects ORDER BY sort_order,created_at"); }
  project(id) { const project = this.projects().find(item => item.id === id); if (!project) throw new Error("工作区不存在"); return project; }
  insertProject({ name, projectPath, workspaceType = "project", linkedAgentKey = null, linkedAgentName = null, disabledPath = null }) {
    if (this.get("SELECT id FROM projects WHERE path=?", projectPath)) throw new Error("该目录已在工作区列表中");
    const id = crypto.randomUUID(), now = Date.now();
    this.run("INSERT INTO projects(id,name,path,workspace_type,linked_agent_key,linked_agent_name,disabled_path,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      id, name, projectPath, workspaceType, linkedAgentKey, linkedAgentName, disabledPath, 0, now, now);
    return this.project(id);
  }
  removeProject(id) { this.project(id); this.run("DELETE FROM projects WHERE id=?", id); }
  reorderProjects(ids) {
    for (const id of ids) this.project(id);
    this.transaction(() => {
      for (const [index, id] of ids.entries()) this.run("UPDATE projects SET sort_order=?,updated_at=? WHERE id=?", index, Date.now(), id);
    });
  }

  // Preset 内技能对各工具的启用开关：默认为已安装且全局启用的工具；不可用的工具始终呈现为关闭。
  scenarioSkillTools(presetId, skillId) {
    if (!this.skillInPreset(presetId, skillId)) throw new Error("该技能未在此 Preset 中启用");
    const disabled = new Set(this.settingJson("disabled_tools", []));
    const tools = this.tools();
    const defaults = tools.filter(tool => tool.installed && !disabled.has(tool.key)).map(tool => tool.key);
    this.transaction(() => {
      for (const key of defaults) this.run("INSERT OR IGNORE INTO scenario_skill_tools(scenario_id,skill_id,tool,enabled,updated_at) VALUES(?,?,?,?,?)", presetId, skillId, key, 1, Date.now());
    });
    const rows = new Map(this.all("SELECT tool,enabled FROM scenario_skill_tools WHERE scenario_id=? AND skill_id=?", presetId, skillId).map(row => [row.tool, !!row.enabled]));
    return tools.map(tool => ({ tool: tool.key, display_name: tool.display_name, installed: tool.installed,
      globally_enabled: !disabled.has(tool.key), enabled: tool.installed && !disabled.has(tool.key) ? rows.get(tool.key) ?? false : false }));
  }
  setScenarioSkillTool(presetId, skillId, tool, enabled) {
    if (!this.skillInPreset(presetId, skillId)) throw new Error("该技能未在此 Preset 中启用");
    const disabled = new Set(this.settingJson("disabled_tools", []));
    const toolDef = this.tools().find(item => item.key === tool);
    if (!toolDef) throw new Error("工具不存在");
    if (enabled) {
      if (!toolDef.installed) throw new Error(`${toolDef.display_name} 未安装`);
      if (disabled.has(tool)) throw new Error(`${toolDef.display_name} 已停用`);
    }
    this.run("INSERT INTO scenario_skill_tools(scenario_id,skill_id,tool,enabled,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(scenario_id,skill_id,tool) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at",
      presetId, skillId, tool, enabled, Date.now());
  }

  // 全部工具（含已从列表移除的）。只有设置页需要看到隐藏项以便恢复，其余调用方一律用 tools()。
  allTools() {
    const disabled = new Set(this.settingJson("disabled_tools", []));
    const hidden = new Set(this.settingJson("hidden_tools", []));
    const paths = this.settingJson("custom_tool_paths", {});
    const projectPaths = this.settingJson("custom_tool_project_paths", {});
    const custom = this.settingJson("custom_tools", []);
    const builtins = definitions.filter(tool => !custom.some(item => item.key === tool.key));
    const result = [...builtins, ...custom.map(tool => ({ ...tool, is_custom: true }))].map(tool => {
      const skillsDirectory = tool.is_custom ? path.resolve(tool.skills_dir) : paths[tool.key] || path.join(this.home, tool.relative_skills_dir);
      return { ...tool, skills_dir: skillsDirectory, installed: tool.is_custom ? fs.existsSync(skillsDirectory) : fs.existsSync(paths[tool.key] || path.join(this.home, tool.relative_detect_dir)),
        enabled: !disabled.has(tool.key), hidden: hidden.has(tool.key), is_custom: !!tool.is_custom, has_path_override: !!paths[tool.key], has_project_path_override: !!projectPaths[tool.key],
        project_relative_skills_dir: projectPaths[tool.key] || tool.project_relative_skills_dir || tool.relative_skills_dir || null };
    });
    const order = this.settingJson("tool_order", []);
    return result.sort((a, b) => (order.indexOf(a.key) < 0 ? 999 : order.indexOf(a.key)) - (order.indexOf(b.key) < 0 ? 999 : order.indexOf(b.key)));
  }

  /** 已从 Agent 列表移除的项：不参与部署、同步与检测，仅设置页用于恢复。 */
  hiddenTools() { return this.allTools().filter(tool => tool.hidden); }

  tools() { return this.allTools().filter(tool => !tool.hidden); }

  /** 移除/恢复 Agent：只改设置，不动磁盘上的 Agent 程序本身。 */
  setToolHidden(key, hidden) {
    if (!key) throw new Error("Agent 标识不能为空");
    const current = this.settingJson("hidden_tools", []);
    const next = hidden ? [...new Set([...current, key])] : current.filter(value => value !== key);
    this.setSetting("hidden_tools", JSON.stringify(next));
  }

  presets() {
    return this.all("SELECT s.*,COUNT(ss.skill_id) AS skill_count FROM scenarios s LEFT JOIN scenario_skills ss ON ss.scenario_id=s.id GROUP BY s.id ORDER BY s.sort_order,s.name");
  }
  preset(id) { const preset = this.presets().find(item => item.id === id); if (!preset) throw new Error("Preset 不存在"); return preset; }
  createPreset(name, description, icon) {
    name = String(name ?? "").trim();
    if (!name) throw new Error("Preset 名称不能为空");
    if (this.get("SELECT id FROM scenarios WHERE name=?", name)) throw new Error(`同名 Preset 已存在：${name}`);
    const id = crypto.randomUUID(), now = Date.now();
    const order = Math.max(0, ...this.all("SELECT sort_order FROM scenarios").map(row => row.sort_order)) + 1;
    this.run("INSERT INTO scenarios(id,name,description,icon,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
      id, name, description ?? null, icon ?? null, order, now, now);
    this.savePresets();
    return this.preset(id);
  }
  updatePreset(id, name, description, icon) {
    const existing = this.preset(id);
    name = String(name ?? "").trim();
    if (!name) throw new Error("Preset 名称不能为空");
    const conflict = this.get("SELECT id FROM scenarios WHERE name=? AND id<>?", name, id);
    if (conflict) throw new Error(`同名 Preset 已存在：${name}`);
    this.run("UPDATE scenarios SET name=?,description=?,icon=?,updated_at=? WHERE id=?",
      name, description ?? existing.description, icon ?? existing.icon, Date.now(), id);
    this.savePresets();
    return this.preset(id);
  }
  deletePreset(id) {
    this.preset(id);
    this.run("DELETE FROM scenarios WHERE id=?", id);
    this.savePresets();
  }
  reorderPresets(ids) {
    for (const id of ids) this.preset(id);
    this.transaction(() => {
      for (const [index, id] of ids.entries()) this.run("UPDATE scenarios SET sort_order=? WHERE id=?", index, id);
    });
    this.savePresets();
  }
  scenarioSkillIds(presetId) {
    this.preset(presetId);
    return this.all("SELECT skill_id FROM scenario_skills WHERE scenario_id=? ORDER BY sort_order,added_at,skill_id", presetId).map(row => row.skill_id);
  }
  reorderScenarioSkills(presetId, skillIds) {
    this.preset(presetId);
    const members = new Set(this.scenarioSkillIds(presetId));
    const unknown = skillIds.filter(id => !members.has(id));
    if (unknown.length) throw new Error("顺序列表包含不属于该 Preset 的技能");
    this.transaction(() => {
      for (const [index, id] of skillIds.entries()) this.run("UPDATE scenario_skills SET sort_order=? WHERE scenario_id=? AND skill_id=?", index, presetId, id);
    });
    this.savePresets();
  }

  saveMetadata(id) {
    const skill = this.get("SELECT * FROM skills WHERE id=?", id); if (!skill) return;
    const relative = path.relative(this.skillsDirectory, skill.central_path).split(path.sep).join("/");
    inside(this.skillsDirectory, relative);
    writeJson(inside(path.join(this.skillsDirectory, ".skills-manager", "skills"), `${id}.json`), {
      schema_version: 1, skill_id: id, path: relative, path_key: relative.normalize("NFC").toLowerCase(), enabled: !!skill.enabled,
      alias: skill.alias ?? null, custom_description: skill.custom_description ?? null, author_override: skill.author_override ?? null,
      icon: skill.icon ?? null,
      tags: this.tags(id), source: { type: skill.source_type, ref: ["local", "import"].includes(skill.source_type) ? null : skill.source_ref,
        branch: skill.source_branch, subpath: skill.source_subpath },
    });
  }

  savePresets() {
    const root = path.join(this.skillsDirectory, ".skills-manager");
    const ids = new Set(this.presets().map(preset => preset.id));
    const folder = path.join(root, "scenarios"); fs.mkdirSync(folder, { recursive: true });
    for (const file of fs.readdirSync(folder)) if (file.endsWith(".json") && !ids.has(file.slice(0, -5))) fs.unlinkSync(inside(folder, file));
    for (const preset of this.presets()) {
      writeJson(path.join(folder, `${preset.id}.json`), { schema_version: 1, scenario_id: preset.id, name: preset.name,
        description: preset.description, icon: preset.icon, sort_order: preset.sort_order });
      const memberships = this.all("SELECT * FROM scenario_skills WHERE scenario_id=?", preset.id);
      const memberFolder = inside(path.join(root, "scenario-skills"), preset.id); fs.mkdirSync(memberFolder, { recursive: true });
      const members = new Set(memberships.map(member => member.skill_id));
      for (const file of fs.readdirSync(memberFolder)) if (file.endsWith(".json") && !members.has(file.slice(0, -5))) fs.unlinkSync(inside(memberFolder, file));
      for (const membership of memberships) writeJson(path.join(memberFolder, `${membership.skill_id}.json`), {
        schema_version: 1, scenario_id: preset.id, skill_id: membership.skill_id, sort_order: membership.sort_order || 0,
        tools: Object.fromEntries(this.all("SELECT tool,enabled FROM scenario_skill_tools WHERE scenario_id=? AND skill_id=?", preset.id, membership.skill_id).map(row => [row.tool, !!row.enabled])),
      });
    }
  }

  reindexMetadata() {
    const directory = path.join(this.skillsDirectory, ".skills-manager", "skills");
    if (!fs.existsSync(directory)) return;
    for (const filename of fs.readdirSync(directory).filter(name => name.endsWith(".json"))) {
      const meta = readJson(inside(directory, filename));
      if (!meta?.skill_id || !meta.path || this.get("SELECT id FROM skills WHERE id=?", meta.skill_id)) continue;
      const location = inside(this.skillsDirectory, meta.path);
      if (!fs.existsSync(location)) continue;
      const info = metadata(location), now = Date.now();
      this.run("INSERT INTO skills(id,name,description,source_type,source_ref,source_subpath,source_branch,central_path,content_hash,enabled,created_at,updated_at,alias,custom_description,author_override,icon) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        meta.skill_id, info.name || path.basename(location), info.description, meta.source?.type || "import", meta.source?.ref,
        meta.source?.subpath, meta.source?.branch, location, hashDirectory(location), meta.enabled !== false, now, now,
        meta.alias ?? null, meta.custom_description ?? null, meta.author_override ?? null, meta.icon ?? null);
      for (const tag of meta.tags || []) this.run("INSERT OR IGNORE INTO skill_tags(skill_id,tag) VALUES(?,?)", meta.skill_id, tag);
    }
    const scenarios = path.join(this.skillsDirectory, ".skills-manager", "scenarios");
    if (fs.existsSync(scenarios)) for (const name of fs.readdirSync(scenarios).filter(name => name.endsWith(".json"))) {
      const preset = readJson(inside(scenarios, name)); if (!preset?.scenario_id) continue;
      this.run("INSERT OR IGNORE INTO scenarios(id,name,description,icon,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?)", preset.scenario_id, preset.name, preset.description, preset.icon, preset.sort_order || 0, Date.now(), Date.now());
    }
  }

  matchSkill(name, filename) {
    if (filename) {
      const target = canonical(path.dirname(filename));
      const matched = this.skills().filter(skill => canonical(skill.central_path) === target || skill.targets.some(item => canonical(item.target_path) === target));
      return matched.length === 1 ? matched[0].id : null;
    }
    const matches = this.skills().filter(skill => skill.name === name || path.basename(skill.central_path) === name);
    return matches.length === 1 ? matches[0].id : null;
  }
}
