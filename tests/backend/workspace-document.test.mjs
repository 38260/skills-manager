import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSkillsRoot, workspaceCommands } from "../../backend/workspace.mjs";
import { projectCommands } from "../../backend/projects.mjs";

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skill-document-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const write = (relative, name) => {
    const target = path.join(directory, relative);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "SKILL.md"), `---\nname: ${name}\n---\n正文 ${name}`);
    fs.writeFileSync(path.join(target, "payload.bin"), Buffer.alloc(1024));
    return target;
  };
  const blockPayloadReads = () => {
    const original = fs.readFileSync;
    t.mock.method(fs, "readFileSync", (file, ...args) => {
      assert.ok(!String(file).endsWith("payload.bin"), "正文或计数不应读取其他文件计算指纹");
      return original(file, ...args);
    });
  };
  return { directory, write, blockPayloadReads };
}

test("全局正文和数量轻量读取，保留嵌套技能与路径边界", t => {
  const { directory, write, blockPayloadReads } = fixture(t);
  write("skills/one", "one");
  write("skills/team/two", "two");
  write("skills/.hidden", "hidden");
  const root = path.join(directory, "skills");
  const store = { tools: () => [{ key: "codex", skills_dir: root }] };
  const commands = workspaceCommands(store, null);
  blockPayloadReads();
  assert.equal(commands.get_global_local_skill_count.call({ agent: "codex" }), 2);
  const doc = commands.get_global_local_skill_document.call({ agent: "codex", skillRelativePath: "team/two" });
  assert.equal(doc.skill_name, "two");
  assert.match(doc.content, /正文 two/);
  for (const skillRelativePath of ["../skills/one", ".hidden", "missing", ""]) {
    assert.throws(() => commands.get_global_local_skill_document.call({ agent: "codex", skillRelativePath }), /未找到/);
  }
  assert.throws(() => commands.get_global_local_skill_count.call({ agent: "unknown" }), /工具不存在/);
});

test("项目与关联工作区正文不扫描内容，启用与停用技能都可读取", t => {
  const { directory, write, blockPayloadReads } = fixture(t);
  write("project/.codex/skills/one", "one");
  write("project/.codex/skills-disabled/two", "two");
  const linked = write("linked/nested/three", "three");
  const records = { normal: { path: path.join(directory, "project") }, linked: {
    workspace_type: "linked", path: path.join(directory, "linked"), linked_agent_key: "linked", linked_agent_name: "Linked",
  } };
  const store = { project: id => records[id], tools: () => [{ key: "codex", display_name: "Codex", project_relative_skills_dir: ".codex/skills" }] };
  const commands = projectCommands(store, null);
  blockPayloadReads();
  for (const skillRelativePath of ["one", "two"]) {
    const doc = commands.get_project_skill_document.call({ projectId: "normal", agent: "codex", skillRelativePath });
    assert.equal(doc.skill_name, skillRelativePath);
  }
  assert.match(commands.get_project_skill_document.call({ projectId: "linked", agent: "linked", skillRelativePath: "nested/three" }).content, /正文 three/);
  assert.ok(fs.existsSync(linked));
  assert.throws(() => commands.get_project_skill_document.call({ projectId: "normal", agent: "unknown", skillRelativePath: "one" }), /未找到/);
});

test("列表默认仍计算内容指纹，外部改动后重新读取", t => {
  const { directory, write } = fixture(t);
  const skill = write("skills/one", "one");
  const options = { enabled: true, agent: "codex", agentDisplayName: "Codex" };
  const first = readSkillsRoot(path.join(directory, "skills"), options)[0];
  assert.match(first.content_hash, /^[a-f0-9]{64}$/);
  assert.equal(typeof first.last_modified_at, "number");
  fs.writeFileSync(path.join(skill, "payload.bin"), "changed content");
  const second = readSkillsRoot(path.join(directory, "skills"), options)[0];
  assert.notEqual(first.content_hash, second.content_hash);
});
