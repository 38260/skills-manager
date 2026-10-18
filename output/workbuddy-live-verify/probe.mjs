import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const base = "http://127.0.0.1:14200";
const activityDb = path.join(os.homedir(), ".skills-manager-activity", "usage.db");
const libraryDb = path.join(os.homedir(), ".skills-manager", "skills-manager.db");
const sessions = {
  explicit: "7bc904b8d5df",
  autoChoice: "9b24d0f618f3",
  negative: "b9dbe0f7b053",
  namedNotRun: "49dce71d62f0",
  plainNews: "3788c312f8f5",
  implicit: "a972dd983758",
};

const invoke = async (name, body) => {
  const response = await fetch(`${base}/api/invoke/${name}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-skills-manager-client": "webview", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  if (!json.ok) throw new Error(`${name}: ${json.message || json.code}`);
  return json.data;
};

const waitIdle = async () => {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const state = await invoke("get_skill_activity_sources");
    if (!state.running) return;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error("扫描超时");
};

const scanOnce = async (label) => {
  const started = await invoke("scan_skill_activity", {});
  await waitIdle();
  const usage = await invoke("get_skill_usage");
  return { label, started, usageFingerprint: fingerprint(usage) };
};

const fingerprint = usage => Object.keys(usage).sort().map(id => [id, usage[id].count, usage[id].lastUsedAt]);

const readState = () => {
  const db = new DatabaseSync(activityDb, { readOnly: true });
  const totals = db.prepare("SELECT kind,trigger,COUNT(*) AS n FROM events WHERE tool=? GROUP BY kind,trigger ORDER BY kind,trigger").all("workbuddy");
  const perSession = {};
  for (const [label, id] of Object.entries(sessions)) {
    perSession[label] = db.prepare("SELECT sessionId,skillName,kind,trigger,status,evidence,sourceLine,timestamp FROM events WHERE tool=? AND sessionId=? ORDER BY sourceLine").all("workbuddy", id);
  }
  db.close();
  const lib = new DatabaseSync(libraryDb, { readOnly: true });
  const skills = lib.prepare("SELECT id,name FROM skills WHERE name IN ('eli5','aihot')").all();
  lib.close();
  return { totals, perSession, skills };
};

const attachUsage = (state, usage) => {
  const byName = {};
  for (const skill of state.skills) byName[skill.name] = usage[skill.id] ?? null;
  return byName;
};

const before = readState();
const usageBefore = await invoke("get_skill_usage");
const scan1 = await scanOnce("scan-1");
const scan2 = await scanOnce("scan-2");
const usageAfter = await invoke("get_skill_usage");
const after = readState();

const report = {
  generatedAt: new Date().toISOString(),
  base,
  usageBefore: attachUsage(before, usageBefore),
  usageAfter: attachUsage(after, usageAfter),
  usageFingerprintEqual: JSON.stringify(fingerprint(usageBefore)) === JSON.stringify(fingerprint(usageAfter)),
  scans: [scan1, scan2],
  totalsBefore: before.totals,
  totalsAfter: after.totals,
  perSession: after.perSession,
};
fs.writeFileSync(path.join(here, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  usageFingerprintEqual: report.usageFingerprintEqual,
  usageBefore: report.usageBefore,
  usageAfter: report.usageAfter,
  totalsBefore: report.totalsBefore,
  totalsAfter: report.totalsAfter,
  sessions: Object.fromEntries(Object.entries(report.perSession).map(([k, v]) => [k, v.length])),
}, null, 2));
