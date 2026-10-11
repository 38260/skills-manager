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
    this.directory = path.resolve(config?.repo_path || this.defaultDirectory);
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

  skills() {
    return this.all("SELECT * FROM skills ORDER BY name").map(row => {
      const meta = metadata(row.central_path);
      return { ...row, enabled: !!row.enabled, description: meta.description || row.description,
        author: meta.author, author_source: meta.author_source,
        tags: this.tags(row.id), targets: this.all("SELECT * FROM skill_targets WHERE skill_id=?", row.id),
        preset_ids: this.all("SELECT scenario_id FROM scenario_skills WHERE skill_id=?", row.id).map(item => item.scenario_id) };
    });
  }
  skill(id) { const skill = this.skills().find(skill => skill.id === id); if (!skill) throw new Error("技能不存在"); return skill; }

  tools() {
    const disabled = new Set(this.settingJson("disabled_tools", []));
    const paths = this.settingJson("custom_tool_paths", {});
    const projectPaths = this.settingJson("custom_tool_project_paths", {});
    const custom = this.settingJson("custom_tools", []);
    const builtins = definitions.filter(tool => !custom.some(item => item.key === tool.key));
    const result = [...builtins, ...custom.map(tool => ({ ...tool, is_custom: true }))].map(tool => {
      const skillsDirectory = tool.is_custom ? path.resolve(tool.skills_dir) : paths[tool.key] || path.join(this.home, tool.relative_skills_dir);
      return { ...tool, skills_dir: skillsDirectory, installed: tool.is_custom ? fs.existsSync(skillsDirectory) : fs.existsSync(paths[tool.key] || path.join(this.home, tool.relative_detect_dir)),
        enabled: !disabled.has(tool.key), is_custom: !!tool.is_custom, has_path_override: !!paths[tool.key],
        project_relative_skills_dir: projectPaths[tool.key] || tool.project_relative_skills_dir || tool.relative_skills_dir || null };
    });
    const order = this.settingJson("tool_order", []);
    return result.sort((a, b) => (order.indexOf(a.key) < 0 ? 999 : order.indexOf(a.key)) - (order.indexOf(b.key) < 0 ? 999 : order.indexOf(b.key)));
  }

  presets() {
    return this.all("SELECT s.*,COUNT(ss.skill_id) AS skill_count FROM scenarios s LEFT JOIN scenario_skills ss ON ss.scenario_id=s.id GROUP BY s.id ORDER BY s.sort_order,s.name");
  }

  saveMetadata(id) {
    const skill = this.get("SELECT * FROM skills WHERE id=?", id); if (!skill) return;
    const relative = path.relative(this.skillsDirectory, skill.central_path).split(path.sep).join("/");
    inside(this.skillsDirectory, relative);
    writeJson(inside(path.join(this.skillsDirectory, ".skills-manager", "skills"), `${id}.json`), {
      schema_version: 1, skill_id: id, path: relative, path_key: relative.normalize("NFC").toLowerCase(), enabled: !!skill.enabled,
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
      this.run("INSERT INTO skills(id,name,description,source_type,source_ref,source_subpath,source_branch,central_path,content_hash,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        meta.skill_id, info.name || path.basename(location), info.description, meta.source?.type || "import", meta.source?.ref,
        meta.source?.subpath, meta.source?.branch, location, hashDirectory(location), meta.enabled !== false, now, now);
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
