import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const sourceDb = path.join(os.homedir(), ".skills-manager-activity", "usage.db");
const work = path.join(here, "restart-check");
const home = path.join(work, "home");
const activity = path.join(home, ".skills-manager-activity");
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(activity, { recursive: true });
fs.mkdirSync(path.join(home, "skills"), { recursive: true });

const python = await new Promise(resolve => {
  const child = spawn("python", ["-c", `import sqlite3\nsrc=sqlite3.connect('file:${sourceDb.replace(/\\/g, "/")}?mode=ro', uri=True)\ndst=sqlite3.connect(r'${path.join(activity, "usage.db").replace(/\\/g, "/")}')\nsrc.backup(dst)\ndst.close()\nsrc.close()`]);
  child.on("exit", code => resolve(code));
});
if (python !== 0) throw new Error(`SQLite 快照失败：${python}`);

const port = 14399;
const child = spawn(process.execPath, ["backend/server.mjs", "--home", home, "--port", String(port)], {
  cwd: path.resolve(here, "..", ".."), stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
let log = "";
child.stdout.on("data", chunk => { log += chunk; });
child.stderr.on("data", chunk => { log += chunk; });

const invoke = async (name, body) => {
  const response = await fetch(`http://127.0.0.1:${port}/api/invoke/${name}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-skills-manager-client": "webview", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response.json();
};

const deadline = Date.now() + 30000;
let health = null;
while (Date.now() < deadline) {
  try {
    health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    if (health.ok) break;
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 300));
}
if (!health?.ok) throw new Error("隔离后端未就绪：" + log);

try {
  const result = await invoke("get_skill_activity", { tool: "workbuddy", pageSize: 1 });
  const db = new DatabaseSync(sourceDb, { readOnly: true });
  const direct = db.prepare("SELECT COUNT(*) AS n FROM events WHERE tool=?").get("workbuddy");
  db.close();
  const report = {
    generatedAt: new Date().toISOString(),
    isolatedHome: home,
    port,
    sourceDb: sourceDb.replace(/\\/g, "/").replace(os.userInfo().username, "<user>"),
    persistedTotal: result.data?.total,
    persistedCounts: result.data?.counts,
    directTotal: direct.n,
    equalsSource: result.data?.total === direct.n,
    serverLog: log.trim().slice(-500),
  };
  fs.writeFileSync(path.join(here, "restart-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  child.kill();
}
