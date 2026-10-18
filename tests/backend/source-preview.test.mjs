import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";

async function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"skills-manager-source-preview-"));
  const store=new Store({directory:path.join(root,"app"),home:root}),library=new Library(store);
  t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  const source=path.join(root,"source");fs.mkdirSync(source);
  fs.writeFileSync(path.join(source,"SKILL.md"),"---\nname: example\n---\nsource v1");
  const skill=await library.installLocal(source);
  return {root,store,library,source,skill};
}

test("原文、差异和并发强制刷新只读取同一份来源，兼容原有两个 API",async t=> {
  const {library,source,skill}=await fixture(t);
  fs.writeFileSync(path.join(source,"SKILL.md"),"---\nname: example\n---\nsource v2");
  const original=library.source.bind(library);let calls=0,cleanups=0;
  t.mock.method(library,"source",async (...args)=> {
    calls++;await new Promise(resolve=>setImmediate(resolve));
    const next=await original(...args),cleanup=next.cleanup;
    return {...next,cleanup:()=>{cleanups++;cleanup();}};
  });
  const [preview,doc,diff]=await Promise.all([library.skillSourcePreview(skill.id),library.sourceSkillDocument(skill.id),library.skillSourceDiff(skill.id)]);
  assert.equal(calls,1);assert.equal(cleanups,1);
  assert.deepEqual(preview.document,doc);assert.deepEqual(preview.diff,diff);
  assert.equal(doc.revision,diff.revision);
  assert.match(doc.content,/source v2/);assert.match(diff.entries[0].updated_text,/source v2/);
  assert.equal(preview.expires_at-preview.cached_at,60000);
  assert.equal(await library.skillSourcePreview(skill.id),preview);assert.equal(calls,1);
  fs.writeFileSync(path.join(source,"SKILL.md"),"---\nname: example\n---\nsource v3");
  const [fresh,same]=await Promise.all([library.skillSourcePreview(skill.id,true),library.skillSourcePreview(skill.id,true)]);
  assert.equal(fresh,same);assert.equal(calls,2);assert.match(fresh.document.content,/source v3/);
});

test("中心库实际内容、来源重新关联和缓存有效期都会使预览重新读取",async t=> {
  const {root,store,library,source,skill}=await fixture(t);
  const original=library.source.bind(library);let calls=0,now=100000;
  t.mock.method(Date,"now",()=>now);
  t.mock.method(library,"source",async (...args)=>{calls++;return original(...args);});
  const first=await library.skillSourcePreview(skill.id);
  fs.writeFileSync(path.join(skill.central_path,"SKILL.md"),"central local edit");
  const edited=await library.skillSourcePreview(skill.id);
  assert.equal(calls,2);assert.match(edited.diff.entries[0].original_text,/central local edit/);assert.notEqual(first,edited);
  const other=path.join(root,"other");fs.mkdirSync(other);fs.writeFileSync(path.join(other,"SKILL.md"),"---\nname: example\n---\nnew origin");
  store.run("UPDATE skills SET source_ref=? WHERE id=?",other,skill.id);
  const relinked=await library.skillSourcePreview(skill.id);
  assert.equal(calls,3);assert.match(relinked.document.content,/new origin/);
  now+=60001;const expired=await library.skillSourcePreview(skill.id);
  assert.equal(calls,4);assert.notEqual(expired,relinked);
  assert.ok(fs.existsSync(path.join(source,"SKILL.md")));
});

test("失败不写入成功缓存，刷新失败保留之前成功结果且之后可以重试",async t=> {
  const {library,skill}=await fixture(t),original=library.source.bind(library);let fail=true,calls=0;
  t.mock.method(library,"source",async (...args)=>{calls++;if(fail)throw new Error("模拟来源断网");return original(...args);});
  await assert.rejects(library.skillSourcePreview(skill.id),/模拟来源断网/);
  assert.equal(library.sourcePreviewCache.size,0);assert.equal(library.sourcePreviewPending.size,0);
  fail=false;const success=await library.skillSourcePreview(skill.id);assert.equal(calls,2);
  fail=true;await assert.rejects(library.skillSourcePreview(skill.id,true),/模拟来源断网/);
  assert.equal(await library.skillSourcePreview(skill.id),success);assert.equal(calls,3);
  fail=false;await library.skillSourcePreview(skill.id,true);assert.equal(calls,4);
});

test("已检测到新的远端 revision 时立即失效旧缓存，不等待 TTL",async t=> {
  const {store,library,source,skill}=await fixture(t),original=library.source.bind(library);let calls=0;
  t.mock.method(library,"source",async (...args)=>{calls++;return original(...args);});
  await library.skillSourcePreview(skill.id);
  fs.writeFileSync(path.join(source,"SKILL.md"),"---\nname: example\n---\nnew detected origin");
  store.run("UPDATE skills SET remote_revision=? WHERE id=?","new-detected-revision",skill.id);
  const next=await library.skillSourcePreview(skill.id);
  assert.equal(calls,2);assert.match(next.document.content,/new detected origin/);
});

test("来源读取期间中心库改变时拒绝混用版本并清理正在读取的资源",async t=> {
  const {library,skill}=await fixture(t),original=library.source.bind(library);let release,cleaned=false;
  const wait=new Promise(resolve=>{release=resolve;});
  t.mock.method(library,"source",async (...args)=>{await wait;const source=await original(...args);return {...source,cleanup:()=>{cleaned=true;source.cleanup();}};});
  const request=library.skillSourcePreview(skill.id);
  fs.writeFileSync(path.join(skill.central_path,"SKILL.md"),"changed during source read");release();
  await assert.rejects(request,/技能或来源已改变/);
  assert.equal(cleaned,true);assert.equal(library.sourcePreviewCache.size,0);assert.equal(library.sourcePreviewPending.size,0);
});

test("真实本地 Git 仓库只克隆一次，文档和差异都标记同一提交",async t=> {
  const {library,source}=await fixture(t);
  const git=(...args)=>execFileSync("git",["-C",source,...args],{encoding:"utf8",windowsHide:true}).trim();
  git("init");git("add","SKILL.md");git("-c","user.name=Fixture","-c","user.email=fixture@example.invalid","commit","-m","fixture v1");
  const skill=await library.installGit(source);
  fs.writeFileSync(path.join(source,"SKILL.md"),"---\nname: example\n---\ngit source v2");
  git("add","SKILL.md");git("-c","user.name=Fixture","-c","user.email=fixture@example.invalid","commit","-m","fixture v2");
  const revision=git("rev-parse","HEAD"),original=library.source.bind(library);let calls=0;
  t.mock.method(library,"source",async (...args)=>{calls++;return original(...args);});
  const [doc,diff]=await Promise.all([library.sourceSkillDocument(skill.id),library.skillSourceDiff(skill.id)]);
  assert.equal(calls,1);assert.equal(doc.revision,revision);assert.equal(diff.revision,revision);
  assert.match(doc.content,/git source v2/);assert.match(diff.entries[0].updated_text,/git source v2/);
});
