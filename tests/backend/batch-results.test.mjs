import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";
import { skillOperationCommands } from "../../backend/skill-operations.mjs";

test("批量更新保留每项名称、实际失败原因和待确认状态，其余技能继续更新", async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"skills-manager-batch-results-"));
  const store=new Store({directory:path.join(root,"app"),home:root}),library=new Library(store);
  t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  const installed=[];
  for(const name of ["good","missing","edited"]) {
    const source=path.join(root,name);fs.mkdirSync(source);fs.writeFileSync(path.join(source,"SKILL.md"),`---\nname: ${name}\n---\nv1`);
    installed.push(await library.installLocal(source));
    fs.writeFileSync(path.join(source,"SKILL.md"),`---\nname: ${name}\n---\nv2`);
  }
  fs.renameSync(path.join(root,"missing"),path.join(root,"missing-moved"));
  fs.writeFileSync(path.join(installed[2].central_path,"SKILL.md"),"user edit");
  const result=await skillOperationCommands(library).batch_update_skills.call({skillIds:installed.map(skill=>skill.id)});
  assert.equal(result.items[0].status,"success");assert.equal(result.items[1].status,"failed");assert.equal(result.items[2].status,"held");
  assert.match(result.items[1].message,/来源/);assert.equal(result.items[1].id,installed[1].id);
  assert.match(fs.readFileSync(path.join(installed[0].central_path,"SKILL.md"),"utf8"),/v2/);
  assert.equal(fs.readFileSync(path.join(installed[2].central_path,"SKILL.md"),"utf8"),"user edit");
});
