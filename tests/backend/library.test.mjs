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
