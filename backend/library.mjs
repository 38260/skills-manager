import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { unzipSync } from "fflate";
import { inside, skillName, metadata, files, hashDirectory, copySkill, skillDirectories, canonical, readJson, writeJson, redact } from "./files.mjs";

// 安装／更新取消登记：key → { cancelled, child }。requestCancel 中止进行中的 git 进程。
const cancels = new Map();
export function registerCancel(key) { const entry = { cancelled: false, child: null }; cancels.set(key, entry); return entry; }
export function requestCancel(key) {
  const entry = cancels.get(key);
  if (!entry) return false;
  entry.cancelled = true;
  try { entry.child?.kill(); } catch {}
  return true;
}
export function releaseCancel(key) { cancels.delete(key); }

export async function git(directory, args, hooks = {}) {
  if (hooks.cancel?.cancelled) throw new Error("操作已取消");
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", directory, ...args], { windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    if (hooks.cancel) hooks.cancel.child = child;
    let stdout = "", stderr = "";
    child.stdout?.on("data", chunk => { stdout += chunk; });
    child.stderr?.on("data", chunk => {
      const text = chunk.toString();
      stderr += text;
      if (hooks.onProgress) for (const line of text.split(/[\r\n]+/)) if (line.trim()) hooks.onProgress(line.trim());
    });
    const timer = setTimeout(() => child.kill(), 600000);
    child.on("error", error => { clearTimeout(timer); reject(new Error(redact(error.message))); });
    child.on("close", code => {
      clearTimeout(timer);
      if (hooks.cancel?.cancelled) { reject(new Error("操作已取消")); return; }
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(redact(stderr || `git 退出码 ${code}`)));
    });
  });
}

// 解析仓库 URL：支持 GitHub tree 链接派生分支与子目录。
export function parseGitUrl(url) {
  if (!url || url.startsWith("-") || (!path.isAbsolute(url) && !/^(https:\/\/|ssh:\/\/|git@)/.test(url))) throw new Error("无效的 Git 来源");
  let branch, subpath;
  if (/^https:\/\//.test(url)) {
    const parsed = new URL(url);
    const match = /^(\/[^/]+\/[^/]+)\/tree\/([^/]+)(?:\/(.*))?$/.exec(parsed.pathname);
    if (match) { url = parsed.origin + match[1] + ".git"; branch ||= decodeURIComponent(match[2]); subpath ||= decodeURIComponent(match[3] || ""); }
  }
  return { url, branch, subpath };
}

const TEXT_LIMIT = 1024 * 1024;
const readText = filename => fs.readFileSync(filename).toString("utf8");
const isExecutable = file => !!(fs.statSync(file.full).mode & 0o111);
const diffKind = (before, after, size) => size > TEXT_LIMIT ? "too_large" : before.includes(0) || after.includes(0) ? "binary" : "text";

export class Library {
  constructor(store, changed = () => {}) { this.store=store; this.changed=changed; this.previews=new Map(); this.updates=new Map(); }
  temporary() { const root=path.join(this.store.directory,"cache"); fs.mkdirSync(root,{recursive:true}); return fs.mkdtempSync(path.join(root,"operation-")); }
  target(skill, tool) { return inside(tool.skills_dir, path.basename(skill.central_path)); }
  tool(key) { const tool=this.store.tools().find(item=>item.key===key); if(!tool) throw new Error("工具不存在"); return tool; }

  document(directory) {
    const filename=["SKILL.md","skill.md"].find(file=>fs.existsSync(path.join(directory,file)));
    if(!filename) throw new Error("没有技能文档");
    if(fs.statSync(path.join(directory,filename)).size>8*1024*1024) throw new Error("文档超过读取上限");
    return { filename, content:fs.readFileSync(path.join(directory,filename),"utf8") };
  }
  sourceLabel(skill) {
    if(["local","import"].includes(skill.source_type)) return skill.source_ref || "";
    const base=skill.source_ref_resolved || skill.source_ref || "";
    return skill.source_branch ? `${base} @ ${skill.source_branch}` : base;
  }
  async source(skill, hooks = {}) {
    if(["local","import"].includes(skill.source_type)) {
      if(!skill.source_ref || !fs.existsSync(skill.source_ref)) throw new Error("原始来源不存在，请重新关联");
      if(fs.statSync(skill.source_ref).isDirectory()) return {directory:skill.source_ref,cleanup:()=>{},revision:hashDirectory(skill.source_ref)};
      const temporary=this.temporary();
      try {
        const data=unzipSync(fs.readFileSync(skill.source_ref),{filter:entry=> {
          if(entry.originalSize>128*1024*1024) throw new Error("压缩文件条目过大");
          inside(temporary,entry.name); return !entry.name.split(/[\\/]/).includes(".git");
        }});
        let total=0;
        for(const [name,bytes] of Object.entries(data)) {
          total+=bytes.length; if(total>512*1024*1024) throw new Error("解压内容超过上限");
          const filename=inside(temporary,name); if(name.endsWith("/")) {fs.mkdirSync(filename,{recursive:true});continue;}
          fs.mkdirSync(path.dirname(filename),{recursive:true}); fs.writeFileSync(filename,bytes);
        }
        const directories=skillDirectories(temporary);
        if(directories.length!==1) throw new Error("压缩包需包含一个明确的技能目录");
        return {directory:directories[0],revision:hashDirectory(directories[0]),cleanup:()=>fs.rmSync(temporary,{recursive:true,force:true})};
      } catch(error) {fs.rmSync(temporary,{recursive:true,force:true});throw error;}
    }
    let {url,branch,subpath}=parseGitUrl(skill.source_ref_resolved || skill.source_ref);
    if(skill.source_type==="skillssh" && !skill.source_ref_resolved) url="https://github.com/"+skill.source_ref.split("/").slice(0,2).join("/")+".git";
    const temporary=this.temporary();
    try {
      await git(temporary,["clone",...(branch?["--branch",branch]:[]),"--",url,"repo"],hooks);
      const repository=path.join(temporary,"repo"),revision=await git(repository,["rev-parse","HEAD"]);
      let directory=subpath?inside(repository,subpath):repository;
      if(!["SKILL.md","skill.md"].some(name=>fs.existsSync(path.join(directory,name)))) {
        const wanted=skill.source_type==="skillssh"?skill.source_ref.split("/").slice(2).join("/"):skill.name;
        const choices=skillDirectories(directory);
        const matches=choices.filter(dir=>metadata(dir).name===wanted || path.basename(dir)===wanted);
        if(matches.length===1) directory=matches[0]; else if(choices.length===1) directory=choices[0]; else throw new Error("需要选择仓库中的具体技能");
      }
      return {directory,revision,url,branch,subpath:path.relative(repository,directory).split(path.sep).join("/"),cleanup:()=>fs.rmSync(temporary,{recursive:true,force:true})};
    } catch(error) {fs.rmSync(temporary,{recursive:true,force:true});throw error;}
  }

  async installLocal(sourcePath,name) {
    const source=await this.source({source_type:"local",source_ref:path.resolve(sourcePath)});
    try {return this.install(source.directory,{name,source_type:fs.statSync(sourcePath).isDirectory()?"local":"import",source_ref:path.resolve(sourcePath)});}
    finally{source.cleanup();}
  }
  async installGit(url,name,hooks = {}) {
    hooks.onPhase?.("cloning");
    const source=await this.source({source_type:"git",source_ref:url},hooks);
    try {
      hooks.onPhase?.("installing");
      return this.install(source.directory,{source_type:"git",source_ref:url,source_ref_resolved:source.url,source_subpath:source.subpath,source_branch:source.branch,source_revision:source.revision});
    } finally {source.cleanup();}
  }
  async installFromSkillssh(source,skillId,hooks = {}) {
    const repoUrl=`https://github.com/${source}.git`,sourceRef=`${source}/${skillId}`;
    if(this.store.skills().some(skill=>skill.source_type==="skillssh"&&skill.source_ref===sourceRef)) throw new Error("该技能已安装，请使用更新入口");
    hooks.onPhase?.("cloning");
    const temporary=this.temporary();
    try {
      await git(temporary,["clone","--",repoUrl,"repo"],hooks);
      const repository=path.join(temporary,"repo"),revision=await git(repository,["rev-parse","HEAD"]);
      const matches=skillDirectories(repository).filter(dir=>metadata(dir).name===skillId||path.basename(dir)===skillId);
      if(matches.length!==1) throw new Error(matches.length?`仓库中有多个匹配 ${skillId} 的技能`:`仓库中没有找到技能 ${skillId}`);
      hooks.onPhase?.("installing");
      return this.install(matches[0],{source_type:"skillssh",source_ref:sourceRef,source_ref_resolved:repoUrl,source_revision:revision});
    } finally {fs.rmSync(temporary,{recursive:true,force:true});}
  }
  install(directory,source={}) {
    const meta=metadata(directory),name=skillName(source.name||meta.name||path.basename(directory));
    let destination=inside(this.store.skillsDirectory,name);
    if(fs.existsSync(destination)) destination=inside(this.store.skillsDirectory,name+"-"+crypto.randomBytes(4).toString("hex"));
    const staged=inside(this.store.skillsDirectory,".install-"+crypto.randomUUID());
    copySkill(directory,staged);
    const id=crypto.randomUUID(),now=Date.now(),hash=hashDirectory(staged);
    try {
      fs.renameSync(staged,destination);
      this.store.run("INSERT INTO skills(id,name,description,source_type,source_ref,source_ref_resolved,source_subpath,source_branch,source_revision,remote_revision,central_path,content_hash,enabled,created_at,updated_at,status,update_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        id,meta.name||name,meta.description,source.source_type||"import",source.source_ref,source.source_ref_resolved,source.source_subpath,source.source_branch,source.source_revision,source.source_revision,destination,hash,true,now,now,"ok",["git","skillssh"].includes(source.source_type)?"up_to_date":"local_only");
      this.saveManifest(id,destination); this.store.saveMetadata(id);this.changed();return this.store.skill(id);
    } catch(error) {if(fs.existsSync(staged))fs.rmSync(staged,{recursive:true,force:true});if(fs.existsSync(destination)&&!this.store.get("SELECT id FROM skills WHERE id=?",id))fs.rmSync(destination,{recursive:true});throw error;}
  }
  saveManifest(id,directory) {writeJson(inside(path.join(this.store.directory,"install-manifests"),`${id}.json`),Object.fromEntries(files(directory).map(file=>[file.relative,crypto.createHash("sha256").update(fs.readFileSync(file.full)).digest("hex")])));}

  async previewGitInstall(url,hooks = {}) {
    hooks.onPhase?.("cloning");
    const parsed=parseGitUrl(url),temporary=this.temporary();
    try {
      await git(temporary,["clone",...(parsed.branch?["--branch",parsed.branch]:[]),"--",parsed.url,"repo"],hooks);
      const repository=path.join(temporary,"repo");
      const root=parsed.subpath?inside(repository,parsed.subpath):repository;
      if(!fs.existsSync(root)) throw new Error("仓库中不存在该子目录");
      const skills=skillDirectories(root).map(directory=>{
        const info=metadata(directory);
        return {rel_path:path.relative(root,directory).split(path.sep).join("/"),name:info.name||path.basename(directory),description:info.description};
      });
      this.previews.set(temporary,{url:parsed.url,branch:parsed.branch,subpath:parsed.subpath,cleanup:()=>fs.rmSync(temporary,{recursive:true,force:true})});
      return {temp_dir:temporary,skills};
    } catch(error) {fs.rmSync(temporary,{recursive:true,force:true});throw error;}
  }
  async confirmGitInstall(repoUrl,tempDir,items) {
    const preview=this.previews.get(tempDir);
    if(!preview||!fs.existsSync(tempDir)) throw new Error("安装预览已失效，请重新获取");
    const repository=path.join(tempDir,"repo");
    const root=preview.subpath?inside(repository,preview.subpath):repository;
    const revision=await git(repository,["rev-parse","HEAD"]);
    try {
      for(const item of items) {
        const directory=inside(root,item.rel_path);
        this.install(directory,{name:item.name?.trim()||undefined,source_type:"git",source_ref:repoUrl,source_ref_resolved:preview.url,source_subpath:path.relative(repository,directory).split(path.sep).join("/"),source_branch:preview.branch,source_revision:revision});
      }
    } finally {preview.cleanup();this.previews.delete(tempDir);}
  }
  cancelGitPreview(tempDir) {
    const preview=this.previews.get(tempDir);
    if(preview) {preview.cleanup();this.previews.delete(tempDir);}
  }

  async check(id) {
    const skill=this.store.skill(id);
    if(!skill.source_ref && !skill.source_ref_resolved) {this.store.run("UPDATE skills SET update_status='local_only',last_checked_at=? WHERE id=?",Date.now(),id);return this.store.skill(id);}
    try {
      const source=await this.source(skill);
      try {this.store.run("UPDATE skills SET remote_revision=?,update_status=?,last_checked_at=?,last_check_error=NULL WHERE id=?",source.revision,hashDirectory(source.directory)===hashDirectory(skill.central_path)?"up_to_date":"update_available",Date.now(),id);}
      finally{source.cleanup();}
    } catch(error) {
      this.store.run("UPDATE skills SET update_status=?,last_checked_at=?,last_check_error=? WHERE id=?",["local","import"].includes(skill.source_type)?"source_missing":"error",Date.now(),redact(error.message),id);
      throw error;
    }
    return this.store.skill(id);
  }

  risks(skill,replacement) {
    const pending=[];
    const baseline=readJson(inside(path.join(this.store.directory,"install-manifests"),`${skill.id}.json`),null);
    const currentHash=hashDirectory(skill.central_path),hasLocal=!!skill.content_hash && currentHash!==skill.content_hash;
    const inspect=(current,base,location,changed)=> {
      if(!fs.existsSync(current))return;
      for(const file of files(current)) {
        const next=inside(replacement,file.relative);
        if(!fs.existsSync(next)) pending.push({location,path:file.relative,reason:"removed"});
        else if(changed) {
          const actual=crypto.createHash("sha256").update(fs.readFileSync(file.full)).digest("hex");
          const prior=base?.[file.relative];
          if((!prior||actual!==prior)&&!fs.readFileSync(file.full).equals(fs.readFileSync(next))) pending.push({location,path:file.relative,reason:"modified"});
        }
      }
    };
    inspect(skill.central_path,baseline,"library",hasLocal||!skill.content_hash);
    const centralManifest=Object.fromEntries(files(skill.central_path).map(file=>[file.relative,crypto.createHash("sha256").update(fs.readFileSync(file.full)).digest("hex")]));
    for(const target of skill.targets.filter(target=>target.mode==="copy")) inspect(target.target_path,centralManifest,target.tool,true);
    return pending.sort((a,b)=>(a.location+a.path).localeCompare(b.location+b.path));
  }
  removalSignature(skill,staged,sourceRevision) {
    return [sourceRevision,hashDirectory(staged),this.risks(skill,staged),hashDirectory(skill.central_path),
      skill.targets.filter(target=>target.mode==="copy").map(target=>[target.target_path,fs.existsSync(target.target_path)?hashDirectory(target.target_path):null])];
  }
  async update(id,approvedRemovals) {
    if(this.updates.has(id)) return this.updates.get(id);
    const operation=this.performUpdate(id,approvedRemovals,false).finally(()=>this.updates.delete(id)); this.updates.set(id,operation);return operation;
  }
  async reimport(id,approvedRemovals) {
    const skill=this.store.skill(id);
    if(!["local","import"].includes(skill.source_type)) throw new Error("只有本地技能可以重新导入");
    if(!skill.source_ref||!fs.existsSync(skill.source_ref)) {
      this.store.run("UPDATE skills SET update_status='source_missing',last_check_error=? WHERE id=?","原始来源路径不存在",id);
      throw new Error("原始来源路径不存在");
    }
    if(this.updates.has(id)) return this.updates.get(id);
    const operation=this.performUpdate(id,approvedRemovals,true).finally(()=>this.updates.delete(id)); this.updates.set(id,operation);return operation;
  }
  async performUpdate(id,approved,local) {
    const skill=this.store.skill(id),source=await this.source(skill);
    const staged=inside(this.store.skillsDirectory,".update-"+crypto.randomUUID());
    try {
      copySkill(source.directory,staged);
      const nextHash=hashDirectory(staged),pending=this.risks(skill,staged);
      const token=crypto.createHash("sha256").update(JSON.stringify(this.removalSignature(skill,staged,source.revision))).digest("hex");
      if(pending.length && approved!==token) {this.store.run("UPDATE skills SET update_status=? WHERE id=?",local?skill.update_status:"update_available",id);return {skill:this.store.skill(id),content_changed:false,pending_removals:pending,removal_approval:token};}
      const changed=nextHash!==hashDirectory(skill.central_path);
      if(changed) {
        const previous=inside(this.store.skillsDirectory,".previous-"+crypto.randomUUID());
        fs.renameSync(skill.central_path,previous);
        try {fs.renameSync(staged,skill.central_path);}
        catch(error){fs.renameSync(previous,skill.central_path);throw error;}
        const info=metadata(skill.central_path);
        try {
          if(local) this.store.run("UPDATE skills SET description=?,content_hash=?,updated_at=?,update_status='local_only',last_checked_at=?,last_check_error=NULL WHERE id=?",info.description,nextHash,Date.now(),Date.now(),id);
          else this.store.run("UPDATE skills SET description=?,content_hash=?,source_revision=?,remote_revision=?,updated_at=?,update_status='up_to_date',last_checked_at=?,last_check_error=NULL WHERE id=?",info.description,nextHash,source.revision,source.revision,Date.now(),Date.now(),id);
          this.saveManifest(id,skill.central_path);
        } catch(error){fs.rmSync(skill.central_path,{recursive:true});fs.renameSync(previous,skill.central_path);throw error;}
        fs.rmSync(previous,{recursive:true});
      } else if(local) this.store.run("UPDATE skills SET update_status='local_only',last_checked_at=?,last_check_error=NULL WHERE id=?",Date.now(),id);
      else this.store.run("UPDATE skills SET update_status='up_to_date',remote_revision=?,last_checked_at=?,last_check_error=NULL WHERE id=?",source.revision,Date.now(),id);
      for(const target of skill.targets.filter(target=>target.mode==="copy")) await this.deploy(id,target.tool,{force:true});
      this.store.saveMetadata(id);this.changed();return {skill:this.store.skill(id),content_changed:changed,pending_removals:[],removal_approval:null};
    } finally {if(fs.existsSync(staged))fs.rmSync(staged,{recursive:true,force:true});source.cleanup();}
  }
  async relink(id,sourcePath,approvedRemovals) {
    const skill=this.store.skill(id);
    if(!["local","import"].includes(skill.source_type)) throw new Error("只有本地技能可以重新关联来源");
    const resolved=path.resolve(sourcePath);
    if(!fs.existsSync(resolved)) throw new Error("新的来源路径不存在");
    if(this.updates.has(id)) return this.updates.get(id);
    const operation=this.performRelink(id,resolved,approvedRemovals).finally(()=>this.updates.delete(id)); this.updates.set(id,operation);return operation;
  }
  async performRelink(id,resolved,approved) {
    const skill=this.store.skill(id),staged=inside(this.store.skillsDirectory,".relink-"+crypto.randomUUID());
    try {
      copySkill(resolved,staged);
      const pending=this.risks(skill,staged);
      const token=crypto.createHash("sha256").update(JSON.stringify(this.removalSignature(skill,staged,hashDirectory(staged)))).digest("hex");
      if(pending.length && approved!==token) {fs.rmSync(staged,{recursive:true,force:true});return {skill:this.store.skill(id),pending_removals:pending,removal_approval:token};}
      const previous=inside(this.store.skillsDirectory,".previous-"+crypto.randomUUID());
      fs.renameSync(skill.central_path,previous);
      try {fs.renameSync(staged,skill.central_path);}
      catch(error){fs.renameSync(previous,skill.central_path);throw error;}
      const info=metadata(skill.central_path);
      try {
        this.store.run("UPDATE skills SET source_ref=?,description=?,content_hash=?,updated_at=?,update_status='local_only',last_check_error=NULL WHERE id=?",resolved,info.description,hashDirectory(skill.central_path),Date.now(),id);
        this.saveManifest(id,skill.central_path);
      } catch(error){fs.rmSync(skill.central_path,{recursive:true});fs.renameSync(previous,skill.central_path);throw error;}
      fs.rmSync(previous,{recursive:true});
      for(const target of skill.targets.filter(target=>target.mode==="copy")) await this.deploy(id,target.tool,{force:true});
      this.store.saveMetadata(id);this.changed();return {skill:this.store.skill(id),pending_removals:[],removal_approval:null};
    } finally {if(fs.existsSync(staged))fs.rmSync(staged,{recursive:true,force:true});}
  }
  detach(id) {
    const skill=this.store.skill(id);
    if(!["local","import"].includes(skill.source_type)) throw new Error("只有本地技能可以分离来源");
    this.store.run("UPDATE skills SET source_ref=NULL,source_ref_resolved=NULL,source_subpath=NULL,source_branch=NULL,source_revision=NULL,remote_revision=NULL,update_status='local_only',updated_at=? WHERE id=?",Date.now(),id);
    this.store.saveMetadata(id);this.changed();
    return this.store.skill(id);
  }
  // 用指定目录内容整体替换中心技能（工作区／项目导入到中心共用）：保留 ID、分类、Preset 与部署关系，
  // 失败回滚为原内容，并强制刷新 copy 模式的部署副本。
  async replaceWithDirectory(id,sourceDir) {
    const skill=this.store.skill(id);
    const staged=inside(this.store.skillsDirectory,".replace-"+crypto.randomUUID());
    copySkill(sourceDir,staged);
    const previous=inside(this.store.skillsDirectory,".previous-"+crypto.randomUUID());
    fs.renameSync(skill.central_path,previous);
    try {fs.renameSync(staged,skill.central_path);}
    catch(error){fs.renameSync(previous,skill.central_path);fs.rmSync(staged,{recursive:true,force:true});throw error;}
    const info=metadata(skill.central_path);
    try {
      this.store.run("UPDATE skills SET description=?,content_hash=?,updated_at=? WHERE id=?",info.description,hashDirectory(skill.central_path),Date.now(),id);
      this.saveManifest(id,skill.central_path);
    } catch(error){fs.rmSync(skill.central_path,{recursive:true,force:true});fs.renameSync(previous,skill.central_path);throw error;}
    fs.rmSync(previous,{recursive:true,force:true});
    for(const target of skill.targets.filter(target=>target.mode==="copy")) await this.deploy(id,target.tool,{force:true});
    this.store.saveMetadata(id);this.changed();
    return this.store.skill(id);
  }

  async deploy(id,key,{force=false,destination}={}) {
    const skill=this.store.skill(id),tool=this.tool(key),target=destination||this.target(skill,tool);
    const old=this.store.get("SELECT * FROM skill_targets WHERE skill_id=? AND tool=?",id,key);
    if(fs.existsSync(target)&&!old&&!force) {
      if(canonical(target)!==canonical(skill.central_path)) throw new Error("目标目录已有未纳管内容，请先导入或认领");
    }
    if(fs.existsSync(target)&&old&&old.mode==="copy"&&!force&&hashDirectory(target)!==old.source_hash) throw new Error("目标副本包含本地修改，请先同步到技能库");
    const mode=this.store.getSetting("sync_mode")||"symlink";
    fs.mkdirSync(path.dirname(target),{recursive:true});
    if(fs.existsSync(target)) {const stat=fs.lstatSync(target);if(stat.isSymbolicLink())fs.unlinkSync(target);else fs.rmSync(target,{recursive:true});}
    if(mode==="copy") copySkill(skill.central_path,target);
    else fs.symlinkSync(skill.central_path,target,process.platform==="win32"?"junction":"dir");
    this.store.run("INSERT INTO skill_targets(id,skill_id,tool,target_path,mode,status,synced_at,source_hash) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(skill_id,tool) DO UPDATE SET target_path=excluded.target_path,mode=excluded.mode,status=excluded.status,synced_at=excluded.synced_at,source_hash=excluded.source_hash",
      old?.id||crypto.randomUUID(),id,key,target,mode,"ok",Date.now(),hashDirectory(skill.central_path));this.changed();
  }
  undeploy(id,key) {
    const target=this.store.get("SELECT * FROM skill_targets WHERE skill_id=? AND tool=?",id,key);if(!target)return;
    if(fs.existsSync(target.target_path)) {
      const stat=fs.lstatSync(target.target_path);
      if(!stat.isSymbolicLink()&&target.source_hash&&hashDirectory(target.target_path)!==target.source_hash) throw new Error("部署副本有本地修改，未删除");
      if(stat.isSymbolicLink())fs.unlinkSync(target.target_path);else fs.rmSync(target.target_path,{recursive:true});
    }
    this.store.run("DELETE FROM skill_targets WHERE id=?",target.id);this.changed();
  }
  // 与其他工具共享同一 skills 目录的部署不被触碰，只删除本条记录。
  unsyncFromTool(id,key) {
    const target=this.store.get("SELECT * FROM skill_targets WHERE skill_id=? AND tool=?",id,key);if(!target)return;
    const stillReferenced=this.store.all("SELECT * FROM skill_targets").some(other=>other.target_path===target.target_path&&!(other.skill_id===id&&other.tool===key));
    if(!stillReferenced&&fs.existsSync(target.target_path)) {
      const stat=fs.lstatSync(target.target_path);
      if(stat.isSymbolicLink()||!target.source_hash||hashDirectory(target.target_path)===target.source_hash) {
        if(stat.isSymbolicLink())fs.unlinkSync(target.target_path);else fs.rmSync(target.target_path,{recursive:true});
      }
    }
    this.store.run("DELETE FROM skill_targets WHERE id=?",target.id);this.changed();
  }
  remove(id) {
    const skill=this.store.skill(id);
    for(const target of skill.targets) {
      if(fs.existsSync(target.target_path)) {
        const stat=fs.lstatSync(target.target_path);
        if(stat.isSymbolicLink()||!target.source_hash||hashDirectory(target.target_path)===target.source_hash) {
          if(stat.isSymbolicLink())fs.unlinkSync(target.target_path);else fs.rmSync(target.target_path,{recursive:true});
        }
      }
      this.store.run("DELETE FROM skill_targets WHERE id=?",target.id);
    }
    inside(this.store.skillsDirectory,path.relative(this.store.skillsDirectory,skill.central_path));
    if(fs.existsSync(skill.central_path))fs.rmSync(skill.central_path,{recursive:true});
    this.store.run("DELETE FROM skills WHERE id=?",id);
    const meta=inside(path.join(this.store.skillsDirectory,".skills-manager","skills"),`${id}.json`);if(fs.existsSync(meta))fs.unlinkSync(meta);this.changed();
  }

  async batchImportFolder(folder,onProgress) {
    let root;
    try {root=fs.realpathSync(path.resolve(folder));} catch {throw new Error("所选路径不存在");}
    if(!fs.statSync(root).isDirectory()) throw new Error("所选路径不是目录");
    const directories=fs.readdirSync(root,{withFileTypes:true})
      .filter(item=>item.isDirectory()&&!item.name.startsWith("."))
      .map(item=>path.join(root,item.name))
      .filter(directory=>["SKILL.md","skill.md"].some(name=>fs.existsSync(path.join(directory,name))));
    let imported=0,skipped=0;const errors=[];
    for(const [index,directory] of directories.entries()) {
      const name=metadata(directory).name||path.basename(directory);
      onProgress?.({current:index+1,total:directories.length,name});
      if(this.store.skills().some(skill=>canonical(skill.central_path)===canonical(path.join(this.store.skillsDirectory,path.basename(directory))))) {skipped++;continue;}
      try {this.install(directory,{source_type:"local",source_ref:directory});imported++;}
      catch(error) {errors.push(`${name}: ${error.message}`);}
    }
    return {imported,skipped,errors};
  }

  skillDocument(id) {
    const skill=this.store.skill(id),doc=this.document(skill.central_path);
    return {skill_id:id,filename:doc.filename,content:doc.content,central_path:skill.central_path};
  }
  async sourceSkillDocument(id) {
    const skill=this.store.skill(id);
    if(["local","import"].includes(skill.source_type)) {
      if(!skill.source_ref||!fs.existsSync(skill.source_ref)) throw new Error("原始来源路径不存在");
      if(!fs.statSync(skill.source_ref).isDirectory()) throw new Error("压缩包来源暂不支持来源文档预览");
      const doc=this.document(skill.source_ref);
      return {skill_id:id,filename:doc.filename,content:doc.content,source_label:this.sourceLabel(skill),revision:"workspace"};
    }
    if(!["git","skillssh"].includes(skill.source_type)) throw new Error("该技能不支持来源文档预览");
    const source=await this.source(skill);
    try {const doc=this.document(source.directory);return {skill_id:id,filename:doc.filename,content:doc.content,source_label:this.sourceLabel(skill),revision:source.revision};}
    finally {source.cleanup();}
  }
  async skillSourceDiff(id) {
    const skill=this.store.skill(id);
    let sourceDirectory,revision,cleanup=()=>{};
    if(["local","import"].includes(skill.source_type)) {
      if(!skill.source_ref||!fs.existsSync(skill.source_ref)||!fs.statSync(skill.source_ref).isDirectory()) throw new Error("来源目录不存在，无法比较差异");
      sourceDirectory=skill.source_ref;revision="workspace";
    } else if(["git","skillssh"].includes(skill.source_type)) {
      const source=await this.source(skill);
      sourceDirectory=source.directory;revision=source.revision;cleanup=source.cleanup;
    } else throw new Error("该技能不支持来源差异比较");
    try {
      const centralFiles=files(skill.central_path),remoteFiles=files(sourceDirectory);
      const remoteMap=new Map(remoteFiles.map(file=>[file.relative,file]));
      const centralSet=new Set(centralFiles.map(file=>file.relative));
      const entries=[];
      for(const file of centralFiles) {
        const next=remoteMap.get(file.relative);
        if(!next) entries.push({relative_path:file.relative,status:"removed",content_kind:"text",original_text:readText(file.full),updated_text:null,executable_before:isExecutable(file),executable_after:false});
        else {
          const before=fs.readFileSync(file.full),after=fs.readFileSync(next.full);
          if(!before.equals(after)) {
            const kind=diffKind(before,after,Math.max(file.size,next.size));
            entries.push({relative_path:file.relative,status:"modified",content_kind:kind,original_text:kind==="text"?before.toString("utf8"):null,updated_text:kind==="text"?after.toString("utf8"):null,executable_before:isExecutable(file),executable_after:isExecutable(next)});
          } else if(isExecutable(file)!==isExecutable(next)) {
            entries.push({relative_path:file.relative,status:"modified",content_kind:"permission_only",original_text:null,updated_text:null,executable_before:isExecutable(file),executable_after:isExecutable(next)});
          }
        }
      }
      for(const file of remoteFiles) if(!centralSet.has(file.relative)) {
        const before=fs.readFileSync(file.full);
        entries.push({relative_path:file.relative,status:"added",content_kind:diffKind(before,before,file.size),original_text:null,updated_text:diffKind(before,before,file.size)==="text"?before.toString("utf8"):null,executable_before:false,executable_after:isExecutable(file)});
      }
      return {skill_id:id,source_label:this.sourceLabel(skill),revision,entries:entries.sort((a,b)=>a.relative_path.localeCompare(b.relative_path))};
    } finally {cleanup();}
  }
  inventory(root,tool) {
    return skillDirectories(root).map(directory=> {
      const info=metadata(directory),hash=hashDirectory(directory);
      const candidates=this.store.skills().filter(skill=>canonical(skill.central_path)===canonical(directory)||skill.targets.some(target=>canonical(target.target_path)===canonical(directory)));
      const named=this.store.skills().filter(skill=>path.basename(skill.central_path)===path.basename(directory)&&skill.content_hash===hash);
      const managed=candidates.length===1?candidates[0]:named.length===1?named[0]:null;
      return {name:info.name||path.basename(directory),dir_name:path.basename(directory),relative_path:path.relative(root,directory).split(path.sep).join("/"),description:info.description,author:info.author,author_source:info.author_source,
        path:directory,files:files(directory).map(file=>file.relative),enabled:!root.endsWith("skills-disabled"),agent:tool.key,agent_display_name:tool.display_name,
        tags:managed?.tags||[],in_center:!!managed,center_skill_id:managed?.id||null,sync_status:managed?hash===hashDirectory(managed.central_path)?"in_sync":"diverged":"project_only"};
    });
  }
}
