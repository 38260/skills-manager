import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";
import { projectCommands } from "../../backend/projects.mjs";
import { readSkillsRoot, workspaceCommands } from "../../backend/workspace.mjs";

test("全局、项目及关联工作区传出有效 Agent 名称，同名启停副本可安全排序", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manager-agent-labels-"));
  const home = path.join(root, "home");
  const store = new Store({ directory: path.join(root, "app"), home }), library = new Library(store);
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const writeSkill = directory => {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "SKILL.md"), "---\nname: alpha\n---\nfixture\n");
  };
  writeSkill(path.join(home, ".codex", "skills", "alpha"));
  const global = workspaceCommands(store, library).get_global_local_skills.call({ agent: "codex" });
  assert.equal(global[0].agent_display_name, "Codex");
  const projectPath = path.join(root, "project");
  writeSkill(path.join(projectPath, ".claude", "skills", "alpha"));
  writeSkill(path.join(projectPath, ".claude", "skills-disabled", "alpha"));
  const commands = projectCommands(store, library), project = commands.add_project.call({ path: projectPath });
  const skills = commands.get_project_skills.call({ projectId: project.id });
  assert.equal(skills.length, 2);
  assert.ok(skills.every(skill => skill.agent_display_name === "Claude Code"));
  assert.doesNotThrow(() => skills.sort((a, b) => a.agent_display_name.localeCompare(b.agent_display_name)));
  const linked = commands.add_linked_workspace.call({ name: "Linked", path: path.join(home, ".codex", "skills") });
  assert.equal(commands.get_project_skills.call({ projectId: linked.id })[0].agent_display_name, "Linked");
  assert.equal(readSkillsRoot(path.join(home, ".codex", "skills"), { agent: "codex", enabled: true, agentDisplayName: "Explicit" })[0].agent_display_name, "Explicit");
  assert.equal(readSkillsRoot(path.join(home, ".codex", "skills"), { agent: "codex", enabled: true })[0].agent_display_name, "codex");
});
