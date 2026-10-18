// 本轮临时工具：三方合并本次增量到索引，工作区和用户起始修改不动。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
const baseline=path.join(os.tmpdir(),"skills-manager-optimization-20261014");
async function git(args,input) {
  return new Promise((resolve,reject)=>{
    const child=spawn("git",args,{windowsHide:true});let out="",err="";
    child.stdout.on("data",b=>out+=b);child.stderr.on("data",b=>err+=b);
    child.on("error",reject);child.on("close",code=>resolve({code,out,err}));
    child.stdin.end(input);
  });
}
const normalize=value=>value.replace(/\r\n/g,"\n");
const prepared=[];
for(const filename of process.argv.slice(2).filter(arg=>!arg.startsWith("--"))) {
  let current=normalize(fs.readFileSync(filename,"utf8"));
  if(filename==="src/lib/tauri.ts"&&process.argv.includes("--strip-source-preview")) {
    current=current.replace(/export interface SkillSourcePreview \{[\s\S]*?\n\}\n\n/,"").replace(/\/\*\* 同一次来源读取生成原文与差异；刷新绕过成功缓存。 \*\/\nexport const getSkillSourcePreview[\s\S]*?\n\n/,"");
  }
  const original=path.join(baseline,filename);
  let content=current;
  if(fs.existsSync(original)) {
    const head=await git(["show",`HEAD:${filename}`]);if(head.code)throw new Error(head.err);
    const work=fs.mkdtempSync(path.join(baseline,"stage-"));
    for(const [name,value] of [["head",head.out],["base",normalize(fs.readFileSync(original,"utf8"))],["next",current]])fs.writeFileSync(path.join(work,name),normalize(value));
    const merged=await git(["merge-file","-p",path.join(work,"head"),path.join(work,"base"),path.join(work,"next")]);
    if(merged.code)throw new Error(`无法安全分离 ${filename}: ${merged.err || merged.out}`);
    content=merged.out;fs.rmSync(work,{recursive:true});
  }
  const hashed=await git(["hash-object","-w","--path",filename,"--stdin"],content);
  if(hashed.code)throw new Error(hashed.err);prepared.push({filename,blob:hashed.out.trim()});
}
for(const {filename,blob} of prepared) {
  const result=await git(["update-index","--add","--cacheinfo",`100644,${blob},${filename}`]);if(result.code)throw new Error(result.err);
}
console.log(prepared.map(item=>item.filename).join("\n"));
