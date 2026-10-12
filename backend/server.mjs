// 本地服务：为前端提供统一调用（/api/invoke）、事件通知（/api/events SSE）与静态托管。
// 仅监听本机回环地址；命令集随 APP 系列任务逐步补齐，未接入的命令返回结构化错误，不伪装成功。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "./store.mjs";
import { ActivityService } from "./activity/service.mjs";
import { Library, registerCancel, releaseCancel } from "./library.mjs";
import { presetCommands } from "./presets.mjs";
import { toolCommands } from "./tools-settings.mjs";
import { scanCommands } from "./scan.mjs";
import { workspaceCommands } from "./workspace.mjs";
import { projectCommands } from "./projects.mjs";
import { repoSettingsCommands } from "./repo-settings.mjs";
import { backupCommands } from "./backup.mjs";
import { shellCommands, attachDiagnostics } from "./shell.mjs";
import { redact } from "./files.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    if (!argv[index].startsWith("--")) continue;
    const key = argv[index].slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) args[key] = true;
    else { args[key] = value; index++; }
  }
  return args;
}

const options = parseArgs(process.argv.slice(2));
const port = Number(options.port || process.env.SKILLS_MANAGER_PORT || 14200);
const host = String(options.host || "127.0.0.1");

let store;
try {
  store = new Store({ directory: typeof options.directory === "string" ? options.directory : undefined,
    home: typeof options.home === "string" ? options.home : undefined });
} catch (error) {
  console.error(`[skills-manager] 本地存储初始化失败：${redact(error.message)}`);
  process.exit(1);
}

// ── 事件通知：SSE 客户端登记 + 防抖广播 ──
const clients = new Set();function broadcast(event, payload) {
  for (const response of clients) response.write(`event: ${event}\ndata: ${JSON.stringify(payload ?? null)}\n\n`);
}
let changeTimer = null;
function notifyChange() {
  if (changeTimer) return;
  changeTimer = setTimeout(() => { changeTimer = null; broadcast("app-files-changed"); }, 300);
}

const library = new Library(store, notifyChange);

// git 操作取消与进度：key 与旧客户端约定一致（安装=来源标识，更新="update:<技能ID>"）。
const gitHooks = key => ({
  cancel: registerCancel(key),
  onPhase: phase => broadcast("install-progress", { skill_id: key, phase }),
  onProgress: detail => broadcast("install-progress", { skill_id: key, phase: "cloning", detail }),
});

// 命令参数使用前端传入的 camelCase 键名；mutating 命令成功后触发一次防抖的事件广播。
const commands = {
  get_tool_status: { call: () => store.tools() },
  get_managed_skills: { call: () => store.skills() },
  get_skills_for_preset: { call: args => store.skillsForPreset(args.presetId) },
  get_all_tags: { call: () => store.all("SELECT DISTINCT tag FROM skill_tags ORDER BY tag").map(row => row.tag) },
  get_skill_categories: { call: () => store.categories() },
  create_skill_category: { call: args => store.createCategory(args.name), mutating: true },
  set_skill_tags: { call: args => store.setTags(args.skillId, Array.isArray(args.tags) ? args.tags : []), mutating: true },
  rename_tag: { call: args => store.renameCategory(args.oldName, args.newName), mutating: true },
  delete_tag: { call: args => store.deleteCategory(args.name), mutating: true },
  get_presets: { call: () => store.presets() },
  get_active_preset: { call: () => {
    const id = store.activeScenarioId();
    return id ? store.presets().find(preset => preset.id === id) ?? null : null;
  } },
  get_settings: { call: args => store.getSetting(String(args.key ?? "")) },
  set_settings: { call: args => store.setSetting(String(args.key ?? ""), String(args.value ?? "")) },
  get_central_repo_path: { call: () => store.directory },
  log_startup_event: { call: args => { console.log(`[startup] ${args.label} ${args.elapsedMs}ms`); return null; } },

  // ── 技能安装 ──
  install_local: { call: async args => { await library.installLocal(args.sourcePath, args.name); }, mutating: true },
  install_git: { call: async args => {
    const key = args.repoUrl, hooks = gitHooks(key);
    try { await library.installGit(args.repoUrl, args.name, hooks); broadcast("install-progress", { skill_id: key, phase: "done" }); }
    finally { releaseCancel(key); }
  }, mutating: true },
  install_from_skillssh: { call: async args => {
    const key = `${args.source}/${args.skillId}`, hooks = gitHooks(key);
    try { await library.installFromSkillssh(args.source, args.skillId, hooks); broadcast("install-progress", { skill_id: key, phase: "done" }); }
    finally { releaseCancel(key); }
  }, mutating: true },
  preview_git_install: { call: async args => {
    const key = args.repoUrl, hooks = gitHooks(key);
    try { return await library.previewGitInstall(args.repoUrl, hooks); }
    finally { releaseCancel(key); }
  } },
  confirm_git_install: { call: async args => { await library.confirmGitInstall(args.repoUrl, args.tempDir, Array.isArray(args.items) ? args.items : []); }, mutating: true },
  cancel_git_preview: { call: args => { library.cancelGitPreview(args.tempDir); } },
  cancel_install: { call: args => requestCancel(args.key) },
  batch_import_folder: { call: args => library.batchImportFolder(args.folderPath, data => broadcast("batch-import-progress", data)), mutating: true },

  // ── 技能更新与维护 ──
  check_skill_update: { call: args => library.check(args.skillId) },
  check_all_skill_updates: { call: async () => {
    const failed = [];
    for (const skill of store.skills()) {
      try { await library.check(skill.id); }
      catch (error) { failed.push(`${skill.id}: ${error.message}`); }
    }
    if (failed.length) throw new Error(`有 ${failed.length} 个技能检查更新失败：${failed.join("; ")}`);
  }, mutating: true },
  update_skill: { call: async args => {
    const hooks = gitHooks(`update:${args.skillId}`);
    try { return await library.update(args.skillId, args.approvedRemovals ?? null); }
    finally { releaseCancel(`update:${args.skillId}`); }
  }, mutating: true },
  reimport_local_skill: { call: args => library.reimport(args.skillId, args.approvedRemovals ?? null), mutating: true },
  relink_local_skill_source: { call: args => library.relink(args.skillId, args.sourcePath, args.approvedRemovals ?? null), mutating: true },
  detach_local_skill_source: { call: args => library.detach(args.skillId), mutating: true },
  batch_update_skills: { call: async args => {
    let refreshed = 0, unchanged = 0;
    const failed = [], held_back = [];
    for (const id of Array.isArray(args.skillIds) ? args.skillIds : []) {
      let skill;
      try { skill = store.skill(id); }
      catch { failed.push(`${id}: 技能不存在`); continue; }
      const isGit = ["git", "skillssh"].includes(skill.source_type);
      try {
        const result = isGit ? await library.update(id) : await library.reimport(id);
        if (result.pending_removals.length) held_back.push(skill.name);
        else if (isGit) result.content_changed ? refreshed++ : unchanged++;
        else refreshed++;
      } catch (error) { failed.push(`${skill.name}: ${error.message}`); }
    }
    return { refreshed, unchanged, failed, held_back };
  }, mutating: true },
  delete_managed_skill: { call: args => library.remove(args.skillId), mutating: true },
  delete_managed_skills: { call: args => {
    let deleted = 0;
    const failed = [];
    for (const id of Array.isArray(args.skillIds) ? args.skillIds : []) {
      try { library.remove(id); deleted++; }
      catch { failed.push(id); }
    }
    return { deleted, failed };
  }, mutating: true },

  // ── 文档与来源比较 ──
  get_skill_document: { call: args => library.skillDocument(args.skillId) },
  get_skill_files: { call: args => library.skillFiles(args.skillId) },
  get_source_skill_document: { call: args => library.sourceSkillDocument(args.skillId) },
  get_skill_source_diff: { call: args => library.skillSourceDiff(args.skillId) },

  // ── 同步部署与 Preset 工具开关 ──
  sync_skill_to_tool: { call: async args => {
    await library.deploy(args.skillId, args.tool);
    const activeId = store.activeScenarioId();
    if (activeId && store.skillInPreset(activeId, args.skillId)) {
      store.scenarioSkillTools(activeId, args.skillId);
      store.setScenarioSkillTool(activeId, args.skillId, args.tool, true);
    }
  }, mutating: true },
  unsync_skill_from_tool: { call: args => {
    library.unsyncFromTool(args.skillId, args.tool);
    const activeId = store.activeScenarioId();
    if (activeId && store.skillInPreset(activeId, args.skillId)) {
      store.scenarioSkillTools(activeId, args.skillId);
      store.setScenarioSkillTool(activeId, args.skillId, args.tool, false);
    }
  }, mutating: true },
  get_skill_tool_toggles: { call: args => store.scenarioSkillTools(args.presetId, args.skillId) },
  set_skill_tool_toggle: { call: args => {
    store.setScenarioSkillTool(args.presetId, args.skillId, args.tool, args.enabled);
    if (store.activeScenarioId() === args.presetId) {
      if (args.enabled) return library.deploy(args.skillId, args.tool);
      library.unsyncFromTool(args.skillId, args.tool);
    }
  }, mutating: true },
  add_skill_to_preset: { call: args => store.addSkillToPreset(args.skillId, args.presetId), mutating: true },
  remove_skill_from_preset: { call: args => store.removeSkillFromPreset(args.skillId, args.presetId), mutating: true },

  // ── Preset 管理 ──
  ...presetCommands(store, library),

  // ── 工具设置 ──
  ...toolCommands(store),

  // ── 扫描导入与市场 ──
  ...scanCommands(store, library),

  // ── 全局工作区 ──
  ...workspaceCommands(store, library),

  // ── 项目工作区 ──
  ...projectCommands(store, library),

  // ── 技能库路径与设备名 ──
  ...repoSettingsCommands(store),

  // ── Git 备份与 GitHub 连接 ──
  ...backupCommands(store, broadcast),
};

// ── 自动备份：默认开启（backup_auto_enabled 为 off/false/0/no 时关闭），每 5 分钟检查一次。
// 仅在备份仓库已初始化时执行本地提交与推送；结果通过独立事件通知，失败记录到设置供页面重现。
let autoBackupRunning = false;
const autoBackupTimer = setInterval(() => {
  if (autoBackupRunning) return;
  let enabled = true;
  try {
    enabled = !["off", "false", "0", "no"].includes(String(store.getSetting("backup_auto_enabled") ?? "").trim().toLowerCase());
  } catch { enabled = true; }
  if (!enabled || !fs.existsSync(path.join(store.skillsDirectory, ".git"))) return;
  autoBackupRunning = true;
  void (async () => {
    try {
      const outcome = await commands.git_backup_sync.call({ message: "自动备份" });
      store.setSetting("backup_last_auto_error", "");
      const pending = store.get("SELECT COUNT(*) AS count FROM pending_conflicts").count > 0;
      broadcast("backup-auto-completed", { ok: true, pending, error: null });
    } catch (error) {
      const message = redact(error.message || String(error));
      store.setSetting("backup_last_auto_error", message);
      broadcast("backup-auto-completed", { ok: false, pending: false, error: message });
    } finally { autoBackupRunning = false; }
  })();
}, 5 * 60 * 1000).unref();

const activity = new ActivityService({
  directory: path.join(store.home, ".skills-manager-activity"), home: store.home,
  env: options.home ? {} : process.env, emit: broadcast,
  skills: () => store.skills(), tools: () => store.tools(),
});
Object.assign(commands, activity.commands);

// ── 桌面外壳与诊断：日志落盘、panic 记录、退出与重启 ──
const diagnostics = attachDiagnostics(store);
Object.assign(commands, shellCommands(store, {
  exit: () => { server?.close(); store.close(); process.exit(0); },
  // 调用记录来源目录同样允许"在文件夹中显示"，便于从记录定位原始日志。
  extraRoots: () => activity.store.sources().map(source => source.path),
  restart: () => {
    if (process.env.SKILLS_MANAGER_ROLE === "electron-backend") { process.exit(0); return; }
    const child = spawn(process.execPath, process.argv.slice(1), { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    server?.close();
    store.close();
    process.exit(0);
  },
}));

function localOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === request.headers.host; }
  catch { return false; }
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  response.end(body);
}

async function readBody(request, limit = 8 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limit) throw new Error("请求体超过大小上限");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handleInvoke(request, response, commandName) {
  if (request.headers["x-skills-manager-client"] !== "webview") {
    sendJson(response, 403, { ok: false, code: "FORBIDDEN", message: "缺少本地客户端标识，已拒绝该请求" });
    return;
  }
  let args = {};
  if (request.method !== "GET") {
    const raw = await readBody(request);
    if (raw.trim()) {
      try { args = JSON.parse(raw); }
      catch { sendJson(response, 400, { ok: false, code: "BAD_REQUEST", message: "请求参数不是有效 JSON" }); return; }
    }
  }
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    sendJson(response, 400, { ok: false, code: "BAD_REQUEST", message: "请求参数必须是对象" });
    return;
  }
  const entry = commands[commandName];
  try {
    if (!entry) throw Object.assign(new Error(`该功能尚未接入本地服务（命令：${commandName}）`), { code: "NOT_IMPLEMENTED" });
    const data = await entry.call(args);
    if (entry.mutating) notifyChange();
    sendJson(response, 200, { ok: true, data: data ?? null });
  } catch (error) {
    sendJson(response, 200, { ok: false, code: error.code || "ERROR", message: redact(error.message || String(error)) });
  }
}

function handleEvents(request, response) {
  response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
  response.write(": connected\n\n");
  clients.add(response);
  const heartbeat = setInterval(() => response.write(": ping\n\n"), 25000);
  request.on("close", () => { clearInterval(heartbeat); clients.delete(response); });
}

// ── 静态托管：托管已构建的 dist，供浏览器直接访问（SPA 路由回退到 index.html） ──
const distDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const mimeTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".map": "application/json", ".txt": "text/plain; charset=utf-8" };
function serveStatic(urlPath, response) {
  if (!fs.existsSync(path.join(distDirectory, "index.html"))) {
    response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    response.end("前端尚未构建：请先运行 npm run build，或使用 npm run dev 的开发模式。");
    return;
  }
  const relative = decodeURIComponent(urlPath.split("?")[0]).replace(/^\/+/, "");
  let filename = path.resolve(distDirectory, relative || "index.html");
  if (filename !== distDirectory && !filename.startsWith(distDirectory + path.sep)) { response.writeHead(403).end(); return; }
  if (!fs.existsSync(filename) || fs.statSync(filename).isDirectory()) filename = path.join(distDirectory, "index.html");
  response.writeHead(200, { "content-type": mimeTypes[path.extname(filename).toLowerCase()] || "application/octet-stream" });
  fs.createReadStream(filename).pipe(response);
}

const server = http.createServer((request, response) => {
  const urlPath = request.url || "/";
  if (!localOrigin(request)) { sendJson(response, 403, { ok: false, code: "FORBIDDEN", message: "跨来源请求已拒绝" }); return; }
  if (urlPath === "/api/health") { sendJson(response, 200, { ok: true, data: { status: "ok" } }); return; }
  if (urlPath === "/api/events") { handleEvents(request, response); return; }
  if (urlPath.startsWith("/api/invoke/")) {
    handleInvoke(request, response, urlPath.slice("/api/invoke/".length).split("?")[0]).catch(error => {
      sendJson(response, 500, { ok: false, code: "INTERNAL", message: redact(error.message || String(error)) });
    });
    return;
  }
  if (urlPath.startsWith("/api/")) { sendJson(response, 404, { ok: false, code: "NOT_FOUND", message: "未知接口" }); return; }
  if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405).end(); return; }
  serveStatic(urlPath, response);
});

server.on("error", error => {
  if (error.code === "EADDRINUSE") {
    console.error(`[skills-manager] 端口 ${port} 已被占用。可用环境变量 SKILLS_MANAGER_PORT 或参数 --port 指定其他端口。`);
    process.exit(1);
  }
  throw error;
});

server.listen(port, host, () => {
  console.log(`[skills-manager] 本地服务已启动：http://${host}:${port}（技能库：${store.directory}）`);
});

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  clearInterval(autoBackupTimer);
  void activity.close();
  server.close(() => { store.close(); diagnostics.close(); process.exit(0); });
  setTimeout(() => { store.close(); diagnostics.close(); process.exit(0); }, 2000).unref();
});
