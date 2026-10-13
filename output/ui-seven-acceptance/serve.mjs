import fs from "node:fs";
import http from "node:http";
import path from "node:path";

// 仅替代外部数据和请求完成时机；前端使用当前完整构建，避免替换被验收的组件逻辑。
const state = { phase: 0, holdDelete: true, holdActivity: false, holdWorkspace: false, sourceFailures: 1, diffFailures: 1, deleted: false };
const counts = {};
const held = [];
const unexpected = new Set();
const tool = { key: "codex", display_name: "Codex", installed: true, enabled: true, hidden: false, category: "coding", skills_dir: "fixture/codex/skills", project_relative_skills_dir: ".codex/skills" };
const skill = id => ({ id, name: id === "demo" ? "audit-demo" : "audit-spare", description: "七项交互验收示例", source_type: "git", source_ref: "https://example.invalid/audit", source_ref_resolved: "https://example.invalid/audit", source_revision: "demo-revision", remote_revision: "demo-revision", central_path: `fixture/skills/${id}`, content_hash: "demo", enabled: true, status: "ok", update_status: "up_to_date", created_at: 1, updated_at: 1, tags: ["验收"], targets: [], preset_ids: ["p-demo"], display_name: id === "demo" ? "audit-demo" : "audit-spare", display_description: "七项交互验收示例", display_author: "示例团队", display_author_source: "metadata.author" });
const local = { name: "workspace-demo", dir_name: "workspace-demo", relative_path: "workspace-demo", description: "键盘与焦点验收", path: "fixture/codex/skills/workspace-demo", files: ["SKILL.md"], enabled: true, agent: "codex", agent_display_name: "Codex", tags: [], in_center: false, sync_status: "project_only", center_skill_id: null };
const settings = { theme: "light", language: "zh", backup_auto_enabled: "off", backup_first_run_prompt: "fresh", agent_control_setup_prompt: "dismissed" };
const doc = id => ({ skill_id: id, filename: "SKILL.md", content: "# 验收示例\n\n正文正常加载。", central_path: `fixture/skills/${id}` });
const hold = key => state[key] ? new Promise(resolve => held.push({ key, resolve })) : Promise.resolve();
const records = () => {
  const event = (id, name, trigger) => ({ id, skillName: name, tool: "codex", skillPath: "fixture/SKILL.md", timestamp: 1791856800000, sessionId: "session-demo", project: "验收项目", callId: id, kind: "invocation", trigger, status: "returned", evidence: "验收依据", sourcePath: "fixture/session.jsonl", sourceLine: "1", managedSkillId: null, usageSkillId: null });
  const selected = { ...event("e1", "audit-demo", state.phase ? "automatic" : "manual"), managedSkillId: "demo", status: state.phase ? "returned" : "pending", evidence: state.phase ? "验收依据：刷新后" : "验收依据：刷新前" };
  const manual = event("e2", "manual-demo", "manual");
  const unknown = event("e3", "unknown-demo", "unknown");
  return state.phase ? [unknown, selected, manual] : [selected, manual, unknown];
};

async function invoke(command, args) {
  switch (command) {
    case "get_settings": return settings[args.key] ?? null;
    case "set_settings": settings[args.key] = args.value; return null;
    case "get_managed_skills": return state.deleted ? [skill("spare")] : [skill("demo"), skill("spare")];
    case "get_tool_status": return [tool];
    case "get_presets": return [{ id: "p-demo", name: "Default", description: null, icon: null, skill_count: state.deleted ? 1 : 2, created_at: 1, updated_at: 1 }];
    case "get_skills_for_preset": return state.deleted ? [skill("spare")] : [skill("demo"), skill("spare")];
    case "get_projects": case "get_preset_skill_order": case "get_hidden_tools": return [];
    case "get_all_tags": case "get_skill_categories": return ["验收"];
    case "get_skill_usage": return {};
    case "get_global_local_skill_count": return 1;
    case "get_global_local_skills": await hold("holdWorkspace"); return [local];
    case "get_global_local_skill_document": return { skill_name: local.name, filename: "SKILL.md", content: "# 工作区文档\n\n工作区正文正常加载。" };
    case "get_skill_document": return doc(args.skillId);
    case "get_skill_files": return { skill_id: args.skillId, root: "fixture", filename: "SKILL.md", entries: [{ relative: "SKILL.md", is_dir: false, size: 50 }] };
    case "get_skill_tool_toggles": return [];
    case "get_source_skill_document":
      if (state.sourceFailures > 0) { state.sourceFailures--; throw new Error("模拟来源原文读取失败（验收夹具）"); }
      return { ...doc(args.skillId), content: "# 上游来源\n\n来源原文已恢复。", source_label: "验收来源", revision: "demo-revision" };
    case "get_skill_source_diff":
      if (state.diffFailures > 0) { state.diffFailures--; throw new Error("模拟来源差异读取失败（验收夹具）"); }
      return { skill_id: args.skillId, source_label: "验收来源", revision: "demo-revision", entries: [] };
    case "get_skill_activity": {
      await hold("holdActivity");
      const items = records();
      return { items, total: items.length, page: 1, pageSize: 20, counts: { invocation: 3, document: 0, request: 0, manual: state.phase ? 1 : 2, automatic: state.phase ? 1 : 0, unknown: 1 } };
    }
    case "get_skill_activity_sources": return { running: false, sources: [{ tool: "codex", path: "fixture", enabled: true, state: "ready", files: 1, processed: 1, errors: 0, lastScan: 1 }] };
    case "scan_skill_activity": case "cancel_skill_activity_scan": return { running: false };
    case "delete_managed_skill": await hold("holdDelete"); state.deleted = true; return null;
    case "git_backup_status": return { git_available: true, initialized: false, remote: null, branch: null, state: "no_remote" };
    case "check_app_update": return { status: "up_to_date", current_version: "1.40.3" };
    case "check_all_skill_updates": case "log_startup_event": return null;
    default: unexpected.add(command); return null;
  }
}

const server = http.createServer(async (request, response) => {
  const send = (value, type = "application/json", status = 200) => { response.writeHead(status, { "content-type": type }); response.end(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)); };
  if (request.url === "/evidence") return send({ state, counts, held: held.map(item => item.key), unexpected: [...unexpected] });
  if (request.url === "/control" && request.method === "POST") {
    let body = ""; for await (const chunk of request) body += chunk;
    Object.assign(state, JSON.parse(body));
    for (let index = held.length - 1; index >= 0; index--) {
      if (!state[held[index].key]) { held[index].resolve(); held.splice(index, 1); }
    }
    return send({ ok: true });
  }
  if (request.url === "/api/events") { response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" }); response.write(": fixture\n\n"); return; }
  if (request.url?.startsWith("/api/invoke/")) {
    let body = ""; for await (const chunk of request) body += chunk;
    const command = request.url.split("/").pop(); counts[command] = (counts[command] ?? 0) + 1;
    try { return send({ ok: true, data: await invoke(command, JSON.parse(body || "{}")) }); }
    catch (error) { return send({ ok: false, message: error.message }, "application/json", 400); }
  }
  const requested = new URL(request.url, "http://127.0.0.1").pathname;
  const root = path.resolve(requested.startsWith("/icons/") || requested === "/vite.svg" ? "public" : "dist");
  const file = path.resolve(root, "." + requested);
  if (file.startsWith(root + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    const mime = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
    return send(fs.readFileSync(file), mime[path.extname(file)] ?? "application/octet-stream");
  }
  send(fs.readFileSync("dist/index.html"), "text/html");
});
server.listen(14232, "127.0.0.1", () => console.log(`UI acceptance fixture: http://127.0.0.1:14232 PID=${process.pid}`));
