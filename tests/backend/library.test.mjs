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

// 安装是「记录 + 目录 + 清单 + 元数据」的整体：任一步失败都必须整体撤销，
// 否则失败提示之后数据库与技能目录仍留着半成品，重装会再多出一份同名技能。
test("安装清单写入失败时整体回滚，重装不产生重复技能",async t=>{
  const {source,store,library}=fixture(t);
  const manifestsDir=path.join(store.directory,"install-manifests");
  const metadataDir=path.join(store.skillsDirectory,".skills-manager","skills");
  const original=library.saveManifest;
  library.saveManifest=()=>{throw new Error("写入安装清单失败");};
  await assert.rejects(library.installLocal(source),/写入安装清单失败/);
  assert.equal(store.skills().length,0,"失败后不应留下技能记录");
  assert.equal(fs.existsSync(path.join(store.skillsDirectory,"example")),false,"失败后不应留下技能目录");
  assert.deepEqual(fs.existsSync(manifestsDir)?fs.readdirSync(manifestsDir):[],[] ,"失败后不应留下安装清单");
  assert.deepEqual(fs.existsSync(metadataDir)?fs.readdirSync(metadataDir):[],[] ,"失败后不应留下技能元数据");
  library.saveManifest=original;
  const skill=await library.installLocal(source);
  assert.equal(store.skills().length,1,"重装后只应有一份技能");
  assert.equal(skill.name,"example");
  assert.equal(fs.existsSync(path.join(store.skillsDirectory,"example")),true);
});

test("技能元数据写入失败同样撤销整个安装",async t=>{
  const {source,store,library}=fixture(t);
  const manifestsDir=path.join(store.directory,"install-manifests");
  store.saveMetadata=()=>{throw new Error("写入技能元数据失败");};
  await assert.rejects(library.installLocal(source),/写入技能元数据失败/);
  assert.equal(store.skills().length,0);
  assert.equal(fs.existsSync(path.join(store.skillsDirectory,"example")),false);
  assert.deepEqual(fs.existsSync(manifestsDir)?fs.readdirSync(manifestsDir):[],[]);
});

for(const phase of ["copy","hash"]) test(`安装${phase}阶段失败清理暂存目录并允许重试`,async t=>{
  const {source,store,library}=fixture(t);
  fs.writeFileSync(path.join(source,"second.txt"),"keep source content");
  if(phase==="copy") {
    const original=fs.copyFileSync;let copied=0;
    t.mock.method(fs,"copyFileSync",(...args)=>{
      if(++copied===2)throw Object.assign(new Error("复制时磁盘已满"),{code:"ENOSPC"});
      return original(...args);
    });
  } else {
    const original=fs.readFileSync;
    t.mock.method(fs,"readFileSync",(filename,...args)=>{
      if(String(filename).includes(".install-"))throw Object.assign(new Error("指纹读取失败"),{code:"EIO"});
      return original(filename,...args);
    });
  }
  await assert.rejects(library.installLocal(source),phase==="copy"?/磁盘已满/:/指纹读取失败/);
  t.mock.restoreAll();
  assert.equal(store.skills().length,0);
  assert.deepEqual(fs.readdirSync(store.skillsDirectory),[],"失败不能留下暂存目录或技能副本");
  assert.equal(fs.readFileSync(path.join(source,"second.txt"),"utf8"),"keep source content");
  const installed=await library.installLocal(source);
  assert.equal(store.skills().length,1);
  assert.equal(fs.readFileSync(path.join(installed.central_path,"second.txt"),"utf8"),"keep source content");
});

// 取消登记的值语义是前端区分「已取消／已完成」的唯一依据，单独固定下来。
test("取消登记：受理置标记，释放后返回未受理",async()=>{
  const {registerCancel,requestCancel,releaseCancel}=await import("../../backend/library.mjs");
  const entry=registerCancel("cancel-key");
  assert.equal(entry.cancelled,false);
  assert.equal(await requestCancel("cancel-key"),true,"已登记的安装应受理取消");
  assert.equal(entry.cancelled,true);
  releaseCancel("cancel-key");
  assert.equal(await requestCancel("cancel-key"),false,"已释放的安装不应再受理取消");
});
