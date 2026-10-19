import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import yaml from "js-yaml";

export function readJson(filename, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filename, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

export function writeJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(temporary, filename);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

export function inside(root, relative = "") {
  const target = path.resolve(root, relative);
  const rel = path.relative(path.resolve(root), target);
  if (rel.startsWith(".." + path.sep) || rel === ".." || path.isAbsolute(rel)) throw new Error("路径超出允许目录");
  return target;
}

export function skillName(name) {
  const value = String(name ?? "").normalize("NFC").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim().replace(/[. ]+$/, "");
  if (!value || /^\.\.?$/.test(value) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(value)) throw new Error("无效的技能名称");
  return value;
}

export function metadata(directory) {
  const file = ["SKILL.md", "skill.md"].map(name => path.join(directory, name)).find(name => fs.existsSync(name));
  if (!file) return { name: null, description: null, author: null, author_source: null };
  let content;
  try {
    const fd = fs.openSync(file, "r");
    try { const buffer = Buffer.alloc(65536); content = buffer.subarray(0, fs.readSync(fd, buffer, 0, buffer.length, 0)).toString("utf8"); }
    finally { fs.closeSync(fd); }
  } catch { return { name: null, description: null, author: null, author_source: null }; }
  content = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const block = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(content.trim());
  let data;
  try { data = block ? yaml.load(block[1], { schema: yaml.JSON_SCHEMA }) : null; }
  catch { data = null; }
  const string = value => typeof value === "string" && value.trim() ? value.trim() : null;
  const standard = string(data?.metadata?.author);
  const legacy = string(data?.author);
  return { name: string(data?.name), description: string(data?.description), author: standard ?? legacy,
    author_source: standard ? "metadata.author" : legacy ? "author" : null };
}

const ignored = new Set([".git", ".skills-manager", "node_modules", "__pycache__", ".DS_Store", "Thumbs.db"]);

export function files(directory, prefix = "") {
  if (!fs.existsSync(directory)) return [];
  const result = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(item.name) || item.name.endsWith(".pyc") || item.isSymbolicLink()) continue;
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) result.push(...files(path.join(directory, item.name), relative));
    else if (item.isFile()) {
      const full = path.join(directory, item.name);
      const stat = fs.statSync(full);
      // mtime 随 size 一起带出：调用方要算"最后修改/指纹"时不必再 stat 一遍。
      result.push({ relative, full, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
  return result.sort((a, b) => Buffer.compare(Buffer.from(a.relative), Buffer.from(b.relative)));
}

// 目录结构：文件与（含空目录的）目录，供详情页"项目结构"展示；不读取内容，忽略项与 files() 保持一致。
export function tree(directory, prefix = "") {
  if (!fs.existsSync(directory)) return [];
  const result = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(item.name) || item.name.endsWith(".pyc") || item.isSymbolicLink()) continue;
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    const full = path.join(directory, item.name);
    if (item.isDirectory()) {
      result.push({ relative, is_dir: true, size: 0 });
      result.push(...tree(full, relative));
    } else if (item.isFile()) {
      result.push({ relative, is_dir: false, size: fs.statSync(full).size });
    }
  }
  return result.sort((a, b) => Buffer.compare(Buffer.from(a.relative), Buffer.from(b.relative)));
}

export function hashDirectory(directory, listing = files(directory)) {
  const hash = crypto.createHash("sha256");
  for (const file of listing) {
    if (path.basename(file.relative) === ".gitignore") continue;
    hash.update(file.relative); hash.update(fs.readFileSync(file.full));
    if (process.platform !== "win32") {
      const permissions = Buffer.alloc(4); permissions.writeUInt32LE(fs.statSync(file.full).mode & 0o111); hash.update(permissions);
    }
  }
  return hash.digest("hex");
}

export function copySkill(source, destination) {
  if (!metadata(source).name && !["SKILL.md", "skill.md"].some(name => fs.existsSync(path.join(source, name)))) throw new Error("目录中没有 SKILL.md");
  fs.mkdirSync(destination, { recursive: true });
  for (const file of files(source)) {
    const target = inside(destination, file.relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file.full, target);
  }
}

export function skillDirectories(root, depth = 0) {
  if (!fs.existsSync(root) || depth > 6) return [];
  if (["SKILL.md", "skill.md"].some(name => fs.existsSync(path.join(root, name)))) return [root];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(item => item.isDirectory() && !ignored.has(item.name) && !item.name.startsWith("."))
    .flatMap(item => skillDirectories(path.join(root, item.name), depth + 1));
}

export function canonical(filename) {
  let value;
  try { value = fs.realpathSync(filename); } catch { value = path.resolve(filename); }
  return process.platform === "win32" ? value.toLowerCase() : value;
}

export function redact(text) {
  return String(text).replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]+)?@/gi, "$1***@")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]+\b/g, "***");
}
