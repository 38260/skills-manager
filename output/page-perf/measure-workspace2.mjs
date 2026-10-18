// 复现 get_global_local_skills 的完整链路并分段计时：readSkillsRoot 与 withCenterState 各占多少。
// 用库的副本（只复制 DB 与 sidecar 元数据），技能内容仍读真实目录。
// 用法：node output/page-perf/measure-workspace2.mjs [agentKey]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../../backend/store.mjs";
import { readSkillsRoot, withCenterState } from "../../backend/workspace.mjs";

const REAL = path.join(os.homedir(), ".skills-manager");
const runTag = new Date().toISOString().replace(/[:.]/g, "-");
const dir = path.resolve("output/page-perf/data", `ws-${runTag}`, ".skills-manager");
fs.mkdirSync(path.join(dir, "skills"), { recursive: true });
for (const name of ["skills-manager.db", "skills-manager.db-wal", "skills-manager.db-shm", ".secret.key", "repo-config.json"]) {
  if (fs.existsSync(path.join(REAL, name))) fs.copyFileSync(path.join(REAL, name), path.join(dir, name));
}
fs.cpSync(path.join(REAL, "skills", ".skills-manager"), path.join(dir, "skills", ".skills-manager"), { recursive: true });

const store = new Store({ directory: dir, home: os.homedir() });
const time = (label, fn) => { const started = performance.now(); const value = fn(); console.log(`  ${label.padEnd(26)} ${(performance.now() - started).toFixed(0)}ms`); return value; };

const toolKey = process.argv[2] ?? "claude_code";
const tool = store.tools().find(item => item.key === toolKey);
if (!tool) throw new Error(`未找到 Agent：${toolKey}`);
console.log(`Agent ${tool.key} → ${tool.skills_dir}`);
console.log(`中心技能 ${store.skills().length} 个\n`);

const raw = time("readSkillsRoot", () => readSkillsRoot(tool.skills_dir, { enabled: true, agent: tool.key, agent_display_name: tool.display_name }));
console.log(`  （技能 ${raw.length} 个）`);
const state = time("withCenterState", () => withCenterState(structuredClone(raw), store));

const matched = state.filter(item => item.in_center);
console.log(`\n  其中命中中心的 ${matched.length} 个：`);
const byStatus = {};
for (const item of state) byStatus[item.sync_status] = (byStatus[item.sync_status] ?? 0) + 1;
console.log(`  同步状态分布 ${JSON.stringify(byStatus)}`);

store.close();
