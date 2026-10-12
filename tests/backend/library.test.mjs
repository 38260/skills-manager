import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"skills-manager-library-test-"));
  const store=new Store({directory:path.join(root,"app"),home:root}),library=new Library(store);
  t.after(()=>{store.close();fs.rmSync(root,{recursive:true});});
  const source=path.join(root,"source");fs.mkdirSync(source);fs.writeFileSync(path.join(source,"SKILL.md"),"---\nname: example\nmetadata:\n  author: Alice\n---\n# Example\nv1\n");
  return {root,source,store,library};
}

test("local updates preserve identity, tags and presets, with no duplicate install",async t=>{
  const {source,store,library}=fixture(t),skill=await library.installLocal(source);
  store.setTags(skill.id,["UI"]);const preset=store.presets()[0];store.run("INSERT INTO scenario_skills(scenario_id,skill_id) VALUES(?,?)",preset.id,skill.id);
  fs.writeFileSync(path.join(source,"SKILL.md"),"---\nname: example\nauthor: Bob\n---\nv2\n");
  const result=await library.update(skill.id);assert.equal(result.content_changed,true);assert.equal(result.skill.author,"Bob");
  assert.deepEqual(result.skill.tags,["UI"]);assert.ok(result.skill.preset_ids.includes(preset.id));assert.equal(store.skills().length,1);
});

test("local edits and removed files require an exact approval and stale approvals do not apply",async t=>{
  const {source,store,library}=fixture(t),skill=await library.installLocal(source);
  fs.writeFileSync(path.join(skill.central_path,"SKILL.md"),"local edited content");
  fs.writeFileSync(path.join(source,"SKILL.md"),"---\nname: example\n---\nremote v2");
  const held=await library.update(skill.id);assert.ok(held.pending_removals.some(item=>item.reason==="modified"));
  assert.equal(fs.readFileSync(path.join(skill.central_path,"SKILL.md"),"utf8"),"local edited content");
  fs.writeFileSync(path.join(skill.central_path,"keep.txt"),"user content");
  const stale=await library.update(skill.id,held.removal_approval);assert.ok(stale.pending_removals.length>0);assert.notEqual(stale.removal_approval,held.removal_approval);
  const applied=await library.update(skill.id,stale.removal_approval);assert.equal(applied.pending_removals.length,0);assert.ok(store.skill(skill.id));
});

test("unclaimed deployment directories are not overwritten; managed edited copies are retained",async t=>{
  const {root,source,store,library}=fixture(t),skill=await library.installLocal(source),target=path.join(root,".codex","skills","example");
  fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,"SKILL.md"),"user skill");
  await assert.rejects(library.deploy(skill.id,"codex"));assert.equal(fs.readFileSync(path.join(target,"SKILL.md"),"utf8"),"user skill");
  fs.rmSync(target,{recursive:true});store.setSetting("sync_mode","copy");await library.deploy(skill.id,"codex");
  fs.writeFileSync(path.join(target,"extra.txt"),"keep");assert.throws(()=>library.undeploy(skill.id,"codex"));assert.ok(fs.existsSync(path.join(target,"extra.txt")));
});

test("archive paths cannot escape the extraction directory",async t=>{
  const {root,library}=fixture(t),archive=path.join(root,"bad.skill");
  fs.writeFileSync(archive,zipSync({"../escape.txt":strToU8("bad"),"SKILL.md":strToU8("---\nname: example\n---\n")}));
  await assert.rejects(library.installLocal(archive));assert.equal(fs.existsSync(path.join(root,"escape.txt")),false);
});

test("skill files list returns the project structure with directories and sizes",async t=>{
  const {source,library}=fixture(t),skill=await library.installLocal(source);
  fs.mkdirSync(path.join(source,"references"));
  fs.writeFileSync(path.join(source,"references","guide.md"),"guide");
  await library.reimport(skill.id);
  const listed=library.skillFiles(skill.id);
  assert.equal(listed.skill_id,skill.id);
  assert.equal(listed.filename,"SKILL.md");
  assert.deepEqual(listed.entries.map(entry=>[entry.relative,entry.is_dir]),[["SKILL.md",false],["references",true],["references/guide.md",false]]);
  assert.ok(listed.entries.find(entry=>entry.relative==="references/guide.md").size>0);
});

test("自定义别名、说明与作者覆盖优先展示，清空后回退技能文件",async t=>{
  const {source,store,library}=fixture(t),skill=await library.installLocal(source);
  const saved=store.setProfile(skill.id,{alias:"示例别名",customDescription:"自定义说明",authorOverride:"张同学"});
  assert.equal(saved.alias,"示例别名");
  assert.equal(saved.display_name,"示例别名");
  assert.equal(saved.display_description,"自定义说明");
  assert.equal(saved.display_author,"张同学");
  assert.equal(saved.display_author_source,"custom");
  // 技能文件里的作者仍然可读，覆盖只影响展示。
  assert.equal(saved.author,"Alice");
  // 清空后回退到技能文件里的值。
  const cleared=store.setProfile(skill.id,{alias:"",customDescription:"",authorOverride:""});
  assert.equal(cleared.alias,null);
  assert.equal(cleared.display_name,"example");
  assert.equal(cleared.display_author,"Alice");
  assert.equal(cleared.display_author_source,"metadata.author");
  // 自定义信息写入 sidecar 元数据，重建索引时可恢复。
  const sidecar=JSON.parse(fs.readFileSync(path.join(store.skillsDirectory,".skills-manager","skills",`${skill.id}.json`),"utf8"));
  assert.equal(sidecar.alias,null);
  assert.equal(sidecar.custom_description,null);
});
