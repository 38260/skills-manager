import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";
import { scanCommands } from "../../backend/scan.mjs";

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manager-discovered-detail-"));
  const home = path.join(root, "home");
  const directory = path.join(root, "data");
  fs.mkdirSync(home, { recursive: true });
  let store = new Store({ directory, home });
  t.after(() => {
    try { store.close(); } catch {}
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  });
  const commands = () => scanCommands(store, new Library(store));
  return {
    root, home, directory,
    get store() { return store; },
    commands,
  };
}

const SKILL_BODY = "---\nname: alpha\ndescription: alpha 描述\n---\n# Alpha\n正文内容\n";

async function scanOneSkill(t) {
  const fixture = setup(t);
  const { root, commands } = fixture;
  const parent = path.join(root, "my-skills");
  fs.mkdirSync(path.join(parent, "alpha"), { recursive: true });
  fs.writeFileSync(path.join(parent, "alpha", "SKILL.md"), SKILL_BODY);

  const scan = commands();
  scan.add_local_discovery_dir.call({ path: parent });
  const result = await scan.scan_local_skills.call({});
  const group = result.groups.find(item => item.name === "alpha");
  assert.ok(group, "扫描结果应包含 alpha 技能");
  return { fixture, scan, foundPath: group.locations[0].found_path };
}

test("discovered skill document returns frontmatter metadata and content only for scanned paths", async t => {
  const { scan, foundPath } = await scanOneSkill(t);

  const doc = scan.get_discovered_skill_document.call({ path: foundPath });
  assert.equal(doc.name, "alpha");
  assert.equal(doc.description, "alpha 描述");
  assert.ok(doc.content.includes("正文内容"));
  assert.equal(doc.language, "zh");
  assert.equal(doc.source_hash, crypto.createHash("sha256").update(SKILL_BODY).digest("hex"));
  assert.ok(doc.fingerprint, "发现记录的指纹应透传给详情");

  // 未扫描过的目录即使真实存在也不允许读取，防止借详情接口读任意文件。
  const unscanned = path.join(path.dirname(foundPath), "..", "unscanned");
  fs.mkdirSync(unscanned, { recursive: true });
  fs.writeFileSync(path.join(unscanned, "SKILL.md"), "---\nname: x\n---\nbody");
  assert.throws(() => scan.get_discovered_skill_document.call({ path: unscanned }), /不在发现结果中/);
  assert.throws(() => scan.get_discovered_skill_document.call({ path: path.join(foundPath, "..", "no-such-dir") }), /请重新扫描|没有 SKILL.md/);
});

test("discovered skill translations round-trip and guard against stale or conflicting saves", async t => {
  const { fixture, scan, foundPath } = await scanOneSkill(t);

  let state = scan.get_discovered_skill_translation.call({ path: foundPath });
  assert.equal(state.skill_id, foundPath);
  assert.equal(state.content, null);
  assert.equal(state.stale, false);

  const saved = scan.set_discovered_skill_translation.call({
    path: foundPath, content: "# 中文版\n", sourceHash: state.source_hash, expectedRevision: state.revision,
  });
  assert.equal(saved.content, "# 中文版\n");
  assert.ok(saved.revision);
  assert.equal(saved.stale, false);

  state = scan.get_discovered_skill_translation.call({ path: foundPath });
  assert.equal(state.content, "# 中文版\n");
  assert.equal(state.stale, false);

  // 修订号冲突：其他窗口已保存过译文。
  assert.throws(() => scan.set_discovered_skill_translation.call({
    path: foundPath, content: "x", sourceHash: state.source_hash, expectedRevision: "stale-revision",
  }), /已被其他窗口修改/);

  // 原文更新后译文标记为过期，且旧原文哈希不再允许保存。
  fs.writeFileSync(path.join(foundPath, "SKILL.md"), SKILL_BODY.replace("正文内容", "改动后的正文"));
  state = scan.get_discovered_skill_translation.call({ path: foundPath });
  assert.equal(state.stale, true);
  assert.throws(() => scan.set_discovered_skill_translation.call({
    path: foundPath, content: "y", sourceHash: state.translated_source_hash, expectedRevision: state.revision,
  }), /英文原文已变化/);

  // 译文按发现路径哈希落盘在独立目录，不写入技能目录本身。
  const dir = path.join(fixture.store.skillsDirectory, ".skills-manager", "translations", "discovered");
  assert.equal(fs.readdirSync(dir).length, 1);
});
