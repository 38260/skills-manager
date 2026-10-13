import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { readSkillsRoot, workspaceCommands } from "../../backend/workspace.mjs";
import { projectCommands } from "../../backend/projects.mjs";

const results = [];
for (const [agent, relative] of [["codex", ".codex/skills"], ["workbuddy", ".workbuddy/skills"], ["claude_code", ".claude/skills"]]) {
  const root = path.join(os.homedir(), relative);
  if (!fs.existsSync(root)) continue;
  const skills = readSkillsRoot(root, { enabled: true, agent, agentDisplayName: agent });
  if (!skills.length) continue;
  const tool = { key: agent, skills_dir: root, display_name: agent };
  const store = { tools: () => [tool], project: () => ({ path: root, workspace_type: "linked", name: agent, linked_agent_key: agent }) };
  const commands = { ...workspaceCommands(store, null), ...projectCommands(store, null) };
  const timings = {};
  for (const name of ["get_global_local_skill_document", "get_project_skill_document", "get_global_local_skill_count"]) {
    if (!commands[name]) continue;
    const samples = [];
    for (let iteration = 0; iteration < 5; iteration++) {
      const started = performance.now();
      const result = commands[name].call({ agent, projectId: "demo", skillRelativePath: skills[0].relative_path });
      samples.push(performance.now() - started);
      if (name.endsWith("count")) assert.equal(result, skills.length);
      else assert.ok(result.content.length > 0 && result.filename.toLowerCase() === "skill.md");
    }
    samples.sort((a, b) => a - b);
    timings[name] = Math.round(samples[2] * 10) / 10;
  }
  results.push({ agent, skillCount: skills.length, medianMs: timings });
}
assert.ok(results.length > 0, "没有可用于只读基准的技能目录");
const target = path.resolve("output/detail-workspace-perf", process.argv[2] ?? "timings.json");
assert.equal(path.dirname(target), path.resolve("output/detail-workspace-perf"));
fs.writeFileSync(target, JSON.stringify({ measuredAt: new Date().toISOString(), results }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(results));
