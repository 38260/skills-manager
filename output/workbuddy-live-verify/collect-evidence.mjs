import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const projects = path.join(process.env.WORKBUDDY_HOME || path.join(os.homedir(), ".workbuddy"), "projects");
const activityDb = path.join(os.homedir(), ".skills-manager-activity", "usage.db");

const cases = [
  { key: "explicit", title: "显式选择技能（UI 技能芯片）", session: "df7a41a6-b5c4-407f-8585-47dd78f3a528", dir: "d-AIWorkSpace-Codex-SkillManager", expected: "manual invocation" },
  { key: "autoChoice", title: "明确要求 Agent 自选技能", session: "8e4bfd6d-4919-4714-bdc1-d1484bb68b77", dir: "d-AIWorkSpace-Codex-SkillManager", expected: "automatic invocation" },
  { key: "negative", title: "仅提及/否定使用", session: "a1d1eb24-3536-4c5c-9704-f9db704ca4bf", dir: "d-AIWorkSpace-Codex-SkillManager", expected: "no invocation and no false request" },
  { key: "namedNotRun", title: "点名但未执行", session: "f8046e60-a570-404e-916c-4a7f44f64c00", dir: "d-AI-Workbuddy-2026-10-18-10-59-26", expected: "pending request only" },
  { key: "plainNews", title: "普通任务未使用技能", session: "44d63bc7-4747-4e72-b8f6-17f9dd535748", dir: "d-AI-Workbuddy-2026-10-18-11-01-59", expected: "no skill event" },
  { key: "implicit", title: "普通任务隐式触发技能", session: "231351f0-740a-449f-aa5c-74b738e3d128", dir: "d-AI-Workbuddy-2026-10-18-11-03-02", expected: "invocation with trigger unknown" },
];

const username = os.userInfo().username;
const sanitize = value => String(value ?? "").replaceAll(username, "<user>");
const db = new DatabaseSync(activityDb, { readOnly: true });

const result = cases.map(item => {
  const filename = path.join(projects, item.dir, `${item.session}.jsonl`);
  const rows = fs.readFileSync(filename, "utf8").split(/\r?\n/).filter(Boolean).map((line, index) => ({ line: index + 1, ...JSON.parse(line) }));
  const user = rows.find(row => row.type === "message" && row.role === "user");
  const content = user ? user.content.map(part => part.text || "").join("\n") : "";
  const query = /<user_query>([\s\S]*?)<\/user_query>/.exec(content)?.[1]?.trim() ?? content;
  const workspace = /Workspace Folder:\s*(\S+)/.exec(content)?.[1] ?? "";
  const calls = rows.filter(row => row.type === "function_call");
  const results = new Map(rows.filter(row => row.type === "function_call_result").map(row => [row.callId, row.status || row.output?.status || ""]));
  const skillCalls = calls.filter(row => row.name === "Skill").map(row => ({
    line: row.line, callId: row.callId, args: String(row.arguments).slice(0, 300), result: results.get(row.callId) || null,
  }));
  const events = db.prepare("SELECT skillName,kind,trigger,status,evidence,sourceLine,callId FROM events WHERE tool=? AND sessionId=? ORDER BY sourceLine")
    .all("workbuddy", item.session).map(event => ({ ...event, sourceLine: String(event.sourceLine) }));
  return {
    key: item.key,
    title: item.title,
    expected: item.expected,
    sessionId: item.session,
    rawLog: sanitize(filename),
    workspace: sanitize(workspace),
    query: sanitize(query),
    functionCalls: calls.map(row => row.name),
    skillCalls: skillCalls.map(call => ({ ...call, args: sanitize(call.args) })),
    managerEvents: events.map(event => ({ ...event, skillName: sanitize(event.skillName) })),
  };
});
db.close();

const report = {
  generatedAt: new Date().toISOString(),
  tool: "workbuddy",
  note: "原始日志来自 WorkBuddy 5.8.3；路径中的用户名已脱敏。事件为测试后实时库快照。",
  cases: result,
};
fs.writeFileSync(path.join(here, "evidence.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(result.map(item => ({ key: item.key, skillCalls: item.skillCalls.length, events: item.managerEvents.length })), null, 2));
