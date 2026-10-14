import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";

test("更新分别报告 Agent 结果，失败保留旧副本，重试保护后来产生的本地编辑", async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"skills-manager-deploy-result-"));
  const store=new Store({directory:path.join(root,"app"),home:root}),library=new Library(store);
  t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  const source=path.join(root,"source");fs.mkdirSync(source);
  fs.writeFileSync(path.join(source,"SKILL.md"),"---\nname: example\n---\nv1");
  const skill=await library.installLocal(source);store.setSetting("sync_mode","copy");
  await library.deploy(skill.id,"codex");await library.deploy(skill.id,"cursor");
  const cursor=store.skill(skill.id).targets.find(target=>target.tool==="cursor").target_path;
  fs.writeFileSync(path.join(source,"SKILL.md"),"---\nname: example\n---\nv2");
  const rename=fs.renameSync;
  t.mock.method(fs,"renameSync",(from,to)=>{
    if(to===cursor&&String(from).includes(".deploy-")&&!String(from).endsWith("-previous")) throw Object.assign(new Error("模拟目标被占用"),{code:"EBUSY"});
    return rename(from,to);
  });
  const result=await library.update(skill.id);t.mock.restoreAll();
  assert.equal(result.content_changed,true);
  assert.equal(result.deployments.find(item=>item.tool==="cursor").status,"failed");
  assert.equal(result.deployments.find(item=>item.tool==="codex").status,"success");
  assert.match(fs.readFileSync(path.join(skill.central_path,"SKILL.md"),"utf8"),/v2/);
  assert.match(fs.readFileSync(path.join(cursor,"SKILL.md"),"utf8"),/v1/);
  fs.writeFileSync(path.join(cursor,"local.txt"),"new local edit");
  const protectedResult=await library.retryDeployments(skill.id,["cursor"]);
  assert.equal(protectedResult[0].status,"failed");assert.ok(fs.existsSync(path.join(cursor,"local.txt")));
  fs.unlinkSync(path.join(cursor,"local.txt"));
  const retried=await library.retryDeployments(skill.id,["cursor"]);
  assert.equal(retried[0].status,"success");assert.match(fs.readFileSync(path.join(cursor,"SKILL.md"),"utf8"),/v2/);
  await assert.rejects(library.retryDeployments(skill.id,["unknown"]));
});
