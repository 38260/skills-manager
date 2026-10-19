// 「上下文 / 命中内容」顺序验收用的隔离数据：一条有真实会话文件的调用记录，
// 上下文窗口（目标行 ±2）里能解析出 user / call / result / assistant 四种角色。
import fs from "node:fs";
import path from "node:path";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";
import { UsageStore } from "../../backend/activity/store.mjs";

const root = path.resolve(process.env.EVIDENCE_ORDER_DATA ?? path.join("output/evidence-order/data", `run-${Date.now()}`));
const home = path.join(root, "home");
fs.mkdirSync(home, { recursive: true });
for (const tool of [".codex", ".claude"]) fs.mkdirSync(path.join(home, tool), { recursive: true });

const store = new Store({ directory: path.join(home, ".skills-manager"), home });
store.setSetting("backup_auto_enabled", "off");
store.setSetting("backup_first_run_prompt", "fresh");
store.setSetting("sync_mode", "copy");

const upstream = path.join(root, "upstream", "alpha-layout");
fs.mkdirSync(upstream, { recursive: true });
fs.writeFileSync(
  path.join(upstream, "SKILL.md"),
  "---\nname: alpha-layout\ndescription: Layout primitives for consistent spacing.\nmetadata:\n  author: 设计团队\n---\n\n# alpha-layout\n\n排版规范与间距基线。\n"
);
const library = new Library(store);
const skill = await library.installLocal(upstream);
const central = skill.central_path;

// 真实会话文件：目标行（第 2 行）是一次读技能文档的调用，前后各有消息与工具返回。
const sessions = path.join(home, ".codex", "sessions");
fs.mkdirSync(sessions, { recursive: true });
const sessionFile = path.join(sessions, "ctx-demo.jsonl");
const lines = [
  { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "按 alpha-layout 的间距规范调整这个页面" }] } },
  { type: "response_item", payload: { type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: `Get-Content "${path.join(central, "SKILL.md")}"` }), call_id: "call_ctx_1" } },
  { type: "response_item", payload: { type: "function_call_output", call_id: "call_ctx_1", output: "# alpha-layout\n\n## 间距\n\n- 4px 基线\n- 区块间距 24px" } },
  { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "已按 4px 基线与 24px 区块间距调整。" }] } },
  { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "还需要补充窄屏断点。" }] } },
];
fs.writeFileSync(sessionFile, `${lines.map(line => JSON.stringify(line)).join("\n")}\n`);

const usage = new UsageStore(path.join(home, ".skills-manager-activity"));
usage.initialize({
  codex: sessions,
  dsh: path.join(home, ".dsh", "sessions"),
  zcode: path.join(home, ".zcode", "sessions"),
  qoder: path.join(home, ".qoder", "projects"),
  workbuddy: path.join(home, ".workbuddy", "projects"),
  workbuddy_ai: path.join(home, ".workbuddy-ai", "projects"),
});
const now = Date.now();
usage.put({
  id: "ctx-001",
  tool: "codex",
  skillName: "alpha-layout",
  skillPath: path.join(central, "SKILL.md"),
  timestamp: now,
  sessionId: "session-ctx-demo",
  project: "C:/dev/checkout-web",
  callId: "call_ctx_1",
  kind: "invocation",
  trigger: "manual",
  status: "returned",
  evidence: "user_selection",
  sourcePath: sessionFile,
  sourceLine: "2",
});
// 几条陪跑记录，确保列表不是只有一条
for (let i = 0; i < 6; i++) {
  usage.put({
    id: `ctx-filler-${i}`,
    tool: "codex",
    skillName: "alpha-layout",
    skillPath: path.join(central, "SKILL.md"),
    timestamp: now - (i + 1) * 30 * 60 * 1000,
    sessionId: `session-filler-${i}`,
    project: "C:/dev/data-pipeline",
    callId: `call_filler_${i}`,
    kind: i % 2 ? "document" : "invocation",
    trigger: i % 2 ? "automatic" : "manual",
    status: "returned",
    evidence: "user_auto_choice",
    sourcePath: path.join(sessions, `missing-${i}.jsonl`),
    sourceLine: "10",
  });
}
usage.close();
console.log(`seeded: excerpt=${sessionFile} root=${path.relative(process.cwd(), root)}`);
