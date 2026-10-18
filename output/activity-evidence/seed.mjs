import fs from "node:fs";
import path from "node:path";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";
import { UsageStore, defaultSources } from "../../backend/activity/store.mjs";

// 独立演示库与客户端目录，禁止读取或改动用户真实技能库。
const root = path.resolve("output/activity-evidence/data/demo");
const home = path.join(root, "home"), directory = path.join(root, "app");
fs.mkdirSync(home, { recursive: true });
if (fs.existsSync(path.join(directory, "skills-manager.db"))) throw new Error("演示库已经存在，拒绝覆盖");
const store = new Store({ directory, home });
const library = new Library(store);
const skills = [];
for (const name of ["ponytail", "computer-use", "ponytail-audit"]) {
  const source = path.join(root, "sources", name);
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "SKILL.md"), `---\nname: ${name}\ndescription: 界面验收演示技能\n---\n# ${name}\n\n用于验证调用记录跳转与返回。\n`);
  skills.push(await library.installLocal(source));
}
store.setSetting("auto_check_skill_updates", "false");
store.setSetting("language", "zh");
const usage = new UsageStore(path.join(home, ".skills-manager-activity"));
usage.initialize(defaultSources(home, {}));
usage.db.prepare("UPDATE sources SET enabled=0,state='idle'").run();
const logs = path.join(root, "logs");
fs.mkdirSync(logs, { recursive: true });
for (let index = 0; index < 65; index++) {
  const skill = skills[index % skills.length], callId = `call-${index}`;
  const file = path.join(logs, `session-${index}.jsonl`);
  const rows = [
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "请检查这个项目的实现。" }] } },
    { metadata: "x".repeat(index === 0 ? 6000 : 0), type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: callId, arguments: JSON.stringify({ cmd: `Get-Content "${skill.central_path.replace(/\\/g, "/")}/SKILL.md"` }) } },
    { type: "response_item", payload: { type: "function_call_output", call_id: callId, output: "Process exited with code 0\n技能文档内容已返回。" } },
  ];
  if (index === 2) rows[1] = "{broken-json";
  fs.writeFileSync(file, rows.map(row => typeof row === "string" ? row : JSON.stringify(row)).join("\n") + "\n");
  usage.put({ id: `demo-${index}`, tool: "codex", skillName: skill.name, skillPath: `${skill.central_path}/SKILL.md`,
    project: "D:/Projects/Demo", timestamp: Date.parse("2026-10-18T13:12:00Z") - index * 60000,
    sessionId: `session-${index}`, callId, kind: index === 4 ? "request" : "document", status: "returned", trigger: "automatic", evidence: "agent_choice", sourcePath: file, sourceLine: "2" });
}
usage.put({ id: "demo-unlinked", tool: "codex", skillName: "unmanaged-skill", skillPath: null, project: "D:/Projects/Demo", timestamp: Date.parse("2026-10-18T13:00:00Z"), sessionId: "s", callId: null, kind: "request", status: "pending", trigger: "manual", evidence: "user_selection", sourcePath: path.join(logs, "missing.jsonl"), sourceLine: "1" });
usage.close(); store.close();
console.log(JSON.stringify({ directory, home }));
