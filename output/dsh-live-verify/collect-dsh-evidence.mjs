// 汇总 DSH 实测证据：原始日志里的技能路径 + 活动库记录 + 最终计数。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { readRecords } from "../../backend/activity/readers.mjs";

const root = path.join(os.homedir(), ".dsh", "sessions");
const cases = [
  { key: "explicit-menu", session: "session-597bc09db3a7", note: "菜单点选注入技能正文；同会话第二条消息再次点名但未产生新调用" },
  { key: "auto-choice", session: "session-86819678f84f", note: "要求自动选择，模型自行调用 skill 工具" },
  { key: "named-not-executed", session: "session-17c0f0d7c001", note: "点名但要求不执行" },
  { key: "mention-negation", session: "session-07036ff5a77d", note: "仅询问技能描述" },
  { key: "implicit", session: "session-39059fa33753", note: "普通任务隐式触发" },
];

function collect(directory, session, found) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(full, session, found);
    else if (entry.name.endsWith(".jsonl.zstd") && full.includes(session)) found.push(full);
  }
}

const db = new DatabaseSync(path.join(os.homedir(), ".skills-manager-activity", "usage.db"), { readOnly: true });
const result = { generatedAt: new Date().toISOString(), tool: "dsh", parserVersion: 7, note: "DSH 实测证据；用户主目录已脱敏为 <user>", cases: [] };

for (const item of cases) {
  const files = [];
  collect(root, item.session, files);
  const users = [], toolCalls = [], invocations = [];
  for await (const record of readRecords(files[0], { compressed: true })) {
    const row = record.row;
    if (!row) continue;
    if (row.type === "user/message" && row.data?.source?.kind === "user") {
      users.push({ line: row.line, text: String(row.data.content?.[0]?.text ?? "").slice(0, 160) });
    }
    if (row.type === "user/message" && row.data?.source?.kind === "skill-invocation") {
      invocations.push({ line: row.line, name: row.data.source.name, messageId: row.data.id });
    }
    if (row.type === "tool/call" && row.data?.name === "skill") {
      toolCalls.push({ line: row.line, callId: row.data.callId, arguments: String(row.data.arguments) });
    }
  }
  const events = db.prepare(
    "SELECT skillName, kind, trigger, status, evidence, sourceLine, callId FROM events WHERE tool='dsh' AND sessionId=? ORDER BY sourceLine",
  ).all(item.session);
  result.cases.push({ ...item, sourceFile: files[0].replace(root, ""), users, skillToolCalls: toolCalls, skillInvocations: invocations, managerEvents: events });
}

result.counts = db.prepare("SELECT kind, trigger, status, COUNT(*) n FROM events WHERE tool='dsh' GROUP BY kind, trigger, status ORDER BY n DESC").all();
result.total = db.prepare("SELECT COUNT(*) n FROM events WHERE tool='dsh'").get().n;
result.usageAnimationVocabulary = db.prepare(
  "SELECT COUNT(*) n, MAX(timestamp) last FROM events WHERE tool='dsh' AND skillName='animation-vocabulary' AND kind<>'request'",
).get();

const target = new URL("./dsh-live.json", import.meta.url);
fs.writeFileSync(target, JSON.stringify(result, null, 2).replaceAll(os.userInfo().username, "<user>"));
console.log("total", result.total, "counts", JSON.stringify(result.counts));
for (const item of result.cases) {
  console.log(item.key, "toolCalls", item.skillToolCalls.length, "injects", item.skillInvocations.length, "events", item.managerEvents.length);
}
