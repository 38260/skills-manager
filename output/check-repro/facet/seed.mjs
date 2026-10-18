// 造一份隔离的调用记录库，用于验证「点击类型页签后统计数字是否漂移」。
// 只写临时目录，不碰用户真实数据（home 通过 --home 指到 output/check-repro/facet/home）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UsageStore, defaultSources, eventId } from "../../../backend/activity/store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const home = path.join(here, "home");
const directory = path.join(home, ".skills-manager-activity");
fs.rmSync(home, { recursive: true, force: true });
fs.mkdirSync(directory, { recursive: true });

const store = new UsageStore(directory);
store.initialize(defaultSources(home, {}));

const rows = [];
let stamp = 1_760_000_000_000;
const push = (kind, trigger, name, i) => rows.push({
  id: eventId("codex", `call-${kind}-${i}`, name), tool: "codex", skillName: name, skillPath: null,
  timestamp: stamp += 60_000, sessionId: "s", project: "/demo", callId: `call-${kind}-${i}`,
  kind, trigger, status: kind === "request" ? "pending" : "returned",
  evidence: kind === "invocation" ? "skill_call" : kind === "document" ? "document_read" : "user_selection",
  sourcePath: "/demo/log.jsonl", sourceLine: String(i + 2),
});
for (let i = 0; i < 40; i++) push("document", i % 2 ? "manual" : "automatic", `skill-${i % 7}`, i);
for (let i = 0; i < 15; i++) push("invocation", i % 3 ? "manual" : "automatic", `skill-${i % 5}`, i);
for (let i = 0; i < 5; i++) push("request", "manual", `skill-${i}`, i);
for (const row of rows) store.put(row);

const summary = store.query();
console.log(JSON.stringify({ seeded: rows.length, total: summary.total, counts: summary.counts }, null, 2));
store.close();
