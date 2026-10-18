import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { inside, hashDirectory, readJson, writeJson, redact } from "./files.mjs";

const ignored = new Set([".git", ".skills-manager", "node_modules", "__pycache__", ".DS_Store", "Thumbs.db"]);
const columns = ["id", "name", "description", "source_type", "source_ref", "source_ref_resolved", "source_subpath", "source_branch", "source_revision", "remote_revision", "central_path", "content_hash", "enabled", "created_at", "updated_at", "status", "update_status", "last_checked_at", "last_check_error", "alias", "custom_description", "author_override"];
const validId = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const digest = value => crypto.createHash("sha256").update(value).digest("hex");

// 拒绝穿过符号链接，防止快照或技能路径被改指到目录边界之外。
function safePath(root, relative, allowLeafLink = false) {
  const target = inside(root, relative);
  const parts = path.relative(root, target).split(path.sep).filter(Boolean);
  let current = path.resolve(root);
  for (const part of ["", ...parts]) {
    current = part ? path.join(current, part) : current;
    try { if (fs.lstatSync(current).isSymbolicLink() && !(allowLeafLink && current === target && current !== path.resolve(root))) throw new Error("快照路径不能包含符号链接"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return target;
}

// 按实际文件逻辑大小计量，包含 snapshot.json；不跟随符号链接。
function storedBytes(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((total, item) => {
    const filename = safePath(directory, item.name);
    return total + (item.isDirectory() ? storedBytes(filename) : item.isFile() ? fs.statSync(filename).size : 0);
  }, 0);
}

function sourceWithoutCredentials(value) {
  if (typeof value !== "string") return value;
  if (/^(https?|ssh):\/\//i.test(value)) {
    const url = new URL(value);
    if (url.password || (url.username && url.protocol !== "ssh:")) { url.username = ""; url.password = ""; }
    for (const key of [...url.searchParams.keys()]) if (/^(token|access_token|api_key|key|password|secret)$/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  }
  return redact(value);
}

function snapshotTree(directory, prefix = "") {
  const entries = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(item.name) || item.name.endsWith(".pyc")) continue;
    if (item.isSymbolicLink()) throw new Error("技能目录包含符号链接，未创建快照");
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    const full = safePath(directory, item.name);
    if (item.isDirectory()) {
      entries.push({ path: relative, directory: true });
      entries.push(...snapshotTree(full, relative));
    } else if (item.isFile()) {
      if (/^(?:\.env(?:\..+)?|\.secret\.key|id_(?:rsa|dsa|ecdsa|ed25519)|(?:credentials|auth|secrets?)(?:\..+)?|.+\.(?:pem|key|p12|pfx))$/i.test(item.name)
        && !/^\.env\.(?:example|sample|template)$/i.test(item.name)) throw new Error("技能目录包含凭据文件，未创建快照");
      const bytes = fs.readFileSync(full);
      if (/(?:-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}\b)/.test(bytes.toString("utf8"))) throw new Error("技能文件包含私钥或访问凭据，未创建快照");
      entries.push({ path: relative, hash: digest(bytes), size: bytes.length, mode: fs.statSync(full).mode & 0o777 });
    } else {
      throw new Error("技能目录包含不支持的文件类型，未创建快照");
    }
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

function copyTree(source, target, entries) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of entries) {
    const destination = safePath(target, entry.path);
    if (entry.directory) { fs.mkdirSync(destination, { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(safePath(source, entry.path), destination);
    fs.chmodSync(destination, entry.mode);
  }
}

export class SkillSnapshots {
  constructor(library) {
    this.library = library;
    this.store = library.store;
    this.directory = safePath(this.store.directory, "skill-snapshots");
    fs.mkdirSync(this.directory, { recursive: true });
    this.restoring = new Map();
  }

  read(id) {
    if (!validId(id)) throw new Error("无效的快照 ID");
    const directory = safePath(this.directory, id);
    const filename = safePath(directory, "snapshot.json");
    if (fs.statSync(filename).size > 4 * 1024 * 1024) throw new Error("快照元数据超过读取上限");
    const record = readJson(filename);
    if (record?.schema_version !== 1 || record.snapshot_id !== id || !validId(record.skill?.id)
      || typeof record.skill.name !== "string" || !record.skill.name || typeof record.skill.source_type !== "string"
      || typeof record.central_relative !== "string" || !record.central_relative || record.central_relative.startsWith(".")
      || !Array.isArray(record.entries) || !Array.isArray(record.tags) || !Array.isArray(record.memberships)
      || !Array.isArray(record.preset_tools) || !Array.isArray(record.targets)) throw new Error("快照元数据无效");
    safePath(this.store.skillsDirectory, record.central_relative);
    return { directory, record };
  }

  summary(record) {
    return { snapshot_id: record.snapshot_id, skill_id: record.skill.id, name: record.skill.alias || record.skill.name,
      reason: record.reason, created_at: record.created_at, file_count: record.entries.filter(entry => !entry.directory).length,
      size_bytes: storedBytes(safePath(this.directory, record.snapshot_id)),
      deleted: !this.store.get("SELECT id FROM skills WHERE id=?", record.skill.id) };
  }

  list() {
    return fs.readdirSync(this.directory, { withFileTypes: true }).filter(entry => entry.isDirectory() && validId(entry.name))
      .flatMap(entry => { try { return [this.summary(this.read(entry.name).record)]; } catch { return []; } })
      .sort((a, b) => b.created_at - a.created_at);
  }

  // 快照是技能目录的完整复制，没有上限就会一直占空间。这里只统计，不删任何东西。
  usage() {
    const snapshots = this.list();
    const bySkill = new Map();
    for (const item of snapshots) {
      const entry = bySkill.get(item.skill_id) ?? { skill_id: item.skill_id, name: item.name, count: 0, size_bytes: 0, latest_at: 0 };
      entry.count += 1;
      entry.size_bytes += item.size_bytes || 0;
      entry.latest_at = Math.max(entry.latest_at, item.created_at || 0);
      entry.name = item.name;
      bySkill.set(item.skill_id, entry);
    }
    return { total_bytes: snapshots.reduce((total, item) => total + (item.size_bytes || 0), 0),
      total_count: snapshots.length, skill_count: bySkill.size,
      by_skill: [...bySkill.values()].sort((a, b) => b.size_bytes - a.size_bytes) };
  }

  // 清理预览：每个技能保留最近 keepLatest 个恢复点，其余列为可删除项，不落任何删除动作。
  planCleanup({ keepLatest = 2, skillId = null } = {}) {
    const keep = Math.max(1, Math.min(20, Number(keepLatest) || 2));
    // list() 已按 created_at 倒序，因此每个技能的前 keep 个就是最近的恢复点。
    const seen = new Map();
    const removable = [];
    for (const item of this.list()) {
      if (skillId && item.skill_id !== skillId) continue;
      const index = seen.get(item.skill_id) ?? 0;
      seen.set(item.skill_id, index + 1);
      if (index < keep) continue;
      // 正在恢复的技能不动：清理与恢复并发时删掉源快照会让恢复读到半截内容。
      if (this.restoring.has(item.skill_id)) continue;
      removable.push({ snapshot_id: item.snapshot_id, skill_id: item.skill_id, name: item.name, reason: item.reason,
        created_at: item.created_at, file_count: item.file_count, size_bytes: item.size_bytes });
    }
    return { keep_latest: keep, skill_id: skillId || null, removable,
      reclaim_bytes: removable.reduce((total, item) => total + (item.size_bytes || 0), 0) };
  }

  // 执行清理：只删预览里列出、且执行时仍不是最近恢复点的快照（预览与执行之间可能有新快照）。
  cleanup({ snapshotIds = [], keepLatest = 2, skillId = null } = {}) {
    const plan = this.planCleanup({ keepLatest, skillId });
    const planned = new Map(plan.removable.map(item => [item.snapshot_id, item]));
    const requested = Array.isArray(snapshotIds) && snapshotIds.length ? snapshotIds : plan.removable.map(item => item.snapshot_id);
    let deleted = 0, reclaimed = 0;
    const failed = [];
    for (const id of requested) {
      if (!validId(id) || !planned.has(id)) { failed.push({ snapshot_id: String(id), message: "该快照是最近的恢复点或已不存在，已跳过" }); continue; }
      try {
        fs.rmSync(safePath(this.directory, id), { recursive: true, force: true });
        deleted += 1;
        reclaimed += planned.get(id).size_bytes || 0;
      } catch (error) {
        failed.push({ snapshot_id: String(id), message: redact(error.message) });
      }
    }
    return { deleted, reclaim_bytes: reclaimed, failed, keep_latest: plan.keep_latest };
  }

  capture(id, reason) {
    const row = this.store.get("SELECT * FROM skills WHERE id=?", id);
    if (!row || !validId(id)) throw new Error("技能不存在");
    const relative = path.relative(this.store.skillsDirectory, row.central_path);
    if (!relative || relative.startsWith(".")) throw new Error("技能目录不能用于创建快照");
    const source = safePath(this.store.skillsDirectory, relative);
    const entries = snapshotTree(source);
    const snapshotId = crypto.randomUUID();
    const directory = safePath(this.directory, snapshotId);
    const content = path.join(directory, "content");
    const manifestPath = safePath(this.store.directory, `install-manifests/${id}.json`);
    const skill = Object.fromEntries(columns.map(column => [column, row[column] ?? null]));
    skill.source_ref = sourceWithoutCredentials(skill.source_ref);
    skill.source_ref_resolved = sourceWithoutCredentials(skill.source_ref_resolved);
    skill.last_check_error = null;
    const record = { schema_version: 1, snapshot_id: snapshotId, reason: String(reason || "before_update"), created_at: Date.now(),
      skill, central_relative: relative.split(path.sep).join("/"), entries, content_hash: hashDirectory(source),
      tags: this.store.tags(id), memberships: this.store.all("SELECT * FROM scenario_skills WHERE skill_id=?", id),
      preset_tools: this.store.all("SELECT * FROM scenario_skill_tools WHERE skill_id=?", id),
      targets: this.store.all("SELECT tool,target_path,mode,status,source_hash FROM skill_targets WHERE skill_id=?", id),
      install_manifest: readJson(manifestPath, null) };
    try {
      copyTree(source, content, entries);
      if (JSON.stringify(snapshotTree(content)) !== JSON.stringify(entries) || hashDirectory(content) !== record.content_hash) throw new Error("快照复制校验失败，原技能保持不变");
      writeJson(path.join(directory, "snapshot.json"), record);
      return this.summary(record);
    } catch (error) {
      if (fs.existsSync(directory)) fs.rmSync(safePath(this.directory, snapshotId), { recursive: true });
      throw error;
    }
  }

  restore(snapshotId) {
    const snapshot = this.read(snapshotId);
    const id = snapshot.record.skill.id;
    if (this.restoring.has(id) || this.library.updates?.has(id)) throw new Error("该技能正在更新或恢复，请等待完成");
    const operation = this.performRestore(snapshot).finally(() => this.restoring.delete(id));
    this.restoring.set(id, operation);
    return operation;
  }

  async performRestore({ directory, record }) {
    const id = record.skill.id;
    const content = safePath(directory, "content");
    if (JSON.stringify(snapshotTree(content)) !== JSON.stringify(record.entries) || hashDirectory(content) !== record.content_hash) throw new Error("快照内容校验失败，未修改技能");
    if (!record.entries.some(entry => !entry.directory && ["SKILL.md", "skill.md"].includes(entry.path))) throw new Error("快照缺少技能文档");
    const destination = safePath(this.store.skillsDirectory, record.central_relative);
    const current = this.store.get("SELECT * FROM skills WHERE id=?", id);
    if (current && path.resolve(current.central_path) !== path.resolve(destination)) throw new Error("技能路径已变化，未恢复旧路径");
    if (!current && (fs.existsSync(destination) || this.store.get("SELECT id FROM skills WHERE central_path=?", destination))) throw new Error("原技能目录已有未纳管内容，未覆盖");
    const targets = current ? this.store.skill(id).targets : record.targets;
    const safetyPoint = current ? this.capture(id, "before_restore") : null;
    const staged = safePath(this.store.skillsDirectory, `.restore-${crypto.randomUUID()}`);
    const previous = `${staged}-previous`;
    const memberships = this.store.all("SELECT * FROM scenario_skills WHERE skill_id=?", id);
    const memberIds = [...new Set([...memberships, ...record.memberships].map(member => member.scenario_id))];
    if (memberIds.some(value => !validId(value))) throw new Error("快照 Preset ID 无效");
    const sidecarPaths = [safePath(this.store.skillsDirectory, `.skills-manager/skills/${id}.json`),
      safePath(this.store.directory, `install-manifests/${id}.json`),
      ...memberIds.map(presetId => safePath(this.store.skillsDirectory, `.skills-manager/scenario-skills/${presetId}/${id}.json`))];
    const sidecars = new Map(sidecarPaths.map(filename => [filename, fs.existsSync(filename) ? fs.readFileSync(filename) : null]));
    let movedCurrent = false;
    let installed = false;
    try {
      copyTree(content, staged, record.entries);
      if (fs.existsSync(destination)) { fs.renameSync(destination, previous); movedCurrent = true; }
      fs.renameSync(staged, destination); installed = true;
      this.store.transaction(() => {
        const restored = { ...record.skill, central_path: destination, updated_at: Date.now(), last_check_error: null };
        // 恢复已有技能时沿用当前认证来源；凭据从不写入快照。
        if (current) { restored.source_ref = current.source_ref; restored.source_ref_resolved = current.source_ref_resolved; }
        this.store.run(`INSERT INTO skills(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")}) ON CONFLICT(id) DO UPDATE SET ${columns.filter(column => column !== "id").map(column => `${column}=excluded.${column}`).join(",")}`,
          ...columns.map(column => restored[column]));
        this.store.run("DELETE FROM skill_tags WHERE skill_id=?", id);
        for (const tag of record.tags) {
          if (typeof tag !== "string" || !tag.trim()) throw new Error("快照标签无效");
          this.store.run("INSERT OR IGNORE INTO skill_tags(skill_id,tag) VALUES(?,?)", id, tag);
        }
        this.store.run("DELETE FROM scenario_skill_tools WHERE skill_id=?", id);
        this.store.run("DELETE FROM scenario_skills WHERE skill_id=?", id);
        for (const member of record.memberships) if (this.store.get("SELECT id FROM scenarios WHERE id=?", member.scenario_id)) {
          this.store.run("INSERT INTO scenario_skills(scenario_id,skill_id,added_at,sort_order) VALUES(?,?,?,?)", member.scenario_id, id, member.added_at, member.sort_order || 0);
          for (const item of record.preset_tools.filter(item => item.scenario_id === member.scenario_id)) {
            if (typeof item.tool !== "string") throw new Error("快照 Agent 配置无效");
            this.store.run("INSERT INTO scenario_skill_tools(scenario_id,skill_id,tool,enabled,updated_at) VALUES(?,?,?,?,?)", member.scenario_id, id, item.tool, item.enabled, item.updated_at || Date.now());
          }
        }
        this.store.saveMetadata(id);
        const manifestPath = sidecarPaths[1];
        if (record.install_manifest) writeJson(manifestPath, record.install_manifest);
        else this.library.saveManifest(id, destination);
        for (const presetId of memberIds) {
          const filename = safePath(this.store.skillsDirectory, `.skills-manager/scenario-skills/${presetId}/${id}.json`);
          const member = this.store.get("SELECT * FROM scenario_skills WHERE scenario_id=? AND skill_id=?", presetId, id);
          if (member) writeJson(filename, { schema_version: 1, scenario_id: presetId, skill_id: id, sort_order: member.sort_order || 0,
            tools: Object.fromEntries(this.store.all("SELECT tool,enabled FROM scenario_skill_tools WHERE scenario_id=? AND skill_id=?", presetId, id).map(item => [item.tool, !!item.enabled])) });
          else if (fs.existsSync(filename)) fs.unlinkSync(filename);
        }
      });
    } catch (error) {
      if (installed) fs.rmSync(safePath(this.store.skillsDirectory, record.central_relative), { recursive: true });
      if (movedCurrent) fs.renameSync(previous, destination);
      for (const [filename, bytes] of sidecars) {
        if (bytes !== null) { fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes); }
        else if (fs.existsSync(filename)) fs.unlinkSync(filename);
      }
      throw error;
    } finally {
      if (fs.existsSync(staged)) fs.rmSync(staged, { recursive: true });
    }
    if (movedCurrent) fs.rmSync(previous, { recursive: true });
    const deployments = [];
    for (const target of targets) {
      try {
        const tool = this.library.tool(target.tool);
        const targetPath = safePath(tool.skills_dir, path.relative(tool.skills_dir, target.target_path), true);
        // 原有链接若被重新指向其他内容，也按用户改动保护。
        let stat;
        try { stat = fs.lstatSync(targetPath); } catch (error) { if (error.code !== "ENOENT") throw error; }
        if (!current && stat) throw new Error("目标目录已有未纳管内容，未覆盖");
        if (current && target.mode === "symlink" && stat && (!stat.isSymbolicLink() || path.resolve(fs.realpathSync(targetPath)) !== path.resolve(destination))) throw new Error("部署链接已被修改，未覆盖");
        await this.library.deploy(id, target.tool, { force: false, destination: targetPath });
        deployments.push({ tool: target.tool, status: "success", message: "已恢复部署" });
      } catch (error) {
        this.store.run("UPDATE skill_targets SET status='error' WHERE skill_id=? AND tool=?", id, target.tool);
        deployments.push({ tool: target.tool, status: "failed", message: redact(error.message) });
      }
    }
    this.library.changed();
    return { skill: this.store.skill(id), snapshot_id: record.snapshot_id, safety_snapshot_id: safetyPoint?.snapshot_id || null, deployments };
  }
}
