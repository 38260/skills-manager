import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";
const home=fs.mkdtempSync(path.join(os.tmpdir(),"skills-manager-optimization-ui-"));
const store=new Store({directory:path.join(home,"app"),home}),library=new Library(store);
store.setSetting("backup_auto_enabled","off");store.setSetting("backup_first_run_prompt","fresh");store.setSetting("auto_update_apply","false");store.setSetting("sync_mode","copy");
for(const agent of [".codex",".cursor"])fs.mkdirSync(path.join(home,agent,"skills"),{recursive:true});
for(let i=0;i<30;i++) {
  const name=`demo-${String(i).padStart(2,"0")}`,source=path.join(home,"sources",name);
  fs.mkdirSync(source,{recursive:true});fs.writeFileSync(path.join(source,"SKILL.md"),`---\nname: ${name}\ndescription: Original review description\n---\n# ${name}\n\n## Usage\nFictional acceptance sample.\n`);
  const skill=await library.installLocal(source);store.addSkillToPreset(skill.id,store.presets()[0].id);
  store.setTags(skill.id,["review"]);
  if(i===0)store.setProfile(skill.id,{alias:"验收别名",customDescription:"自定义检索说明",authorOverride:"Demo Author"});
}
store.close();fs.writeFileSync(path.join(os.tmpdir(),"skills-manager-optimization-ui-home.txt"),home);
console.log(home);
