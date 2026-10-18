// 扩展命令独立登记，避免把用户现有服务接入改动捆进本轮提交。
import { redact } from "./files.mjs";
import { SkillSnapshots } from "./skill-snapshots.mjs";

export function skillOperationCommands(library) {
  library.snapshots ??= new SkillSnapshots(library);
  return {
    get_skill_snapshots: { call: () => library.snapshots.list() },
    // 快照占用与清理：先看总量/按技能分组，再预览、再执行，执行时复核「最近恢复点」不被删。
    get_snapshot_usage: { call: () => library.snapshots.usage() },
    preview_snapshot_cleanup: { call: args => library.snapshots.planCleanup({ keepLatest: args.keepLatest, skillId: args.skillId ?? null }) },
    cleanup_snapshots: { call: args => library.snapshots.cleanup({ snapshotIds: args.snapshotIds, keepLatest: args.keepLatest, skillId: args.skillId ?? null }), mutating: true },
    restore_skill_snapshot: { call: args => library.snapshots.restore(args.snapshotId), mutating: true },
    retry_skill_deployments: { call: args => library.retryDeployments(args.skillId, args.tools), mutating: true },
    get_skill_source_preview: { call: args => library.skillSourcePreview(args.skillId, args.forceRefresh === true) },
    batch_update_skills: { call: async args => {
      const items=[];let refreshed=0,unchanged=0;const failed=[],held_back=[];
      for(const id of [...new Set(Array.isArray(args.skillIds)?args.skillIds:[])]) {
        let skill;
        try {
          skill=library.store.skill(id);
          const result=["git","skillssh"].includes(skill.source_type)?await library.update(id):await library.reimport(id);
          if(result.pending_removals.length) {held_back.push(skill.name);items.push({id,name:skill.name,status:"held",message:"存在本地编辑或文件移除，请单项更新并确认"});continue;}
          result.content_changed===false?unchanged++:refreshed++;
          const deployments=result.deployments??[],errors=deployments.filter(item=>item.status==="failed");
          const message=errors.length?`中央库已更新；${errors.map(item=>`${item.tool}: ${item.message}`).join("；")}`:"中央库及部署更新完成";
          if(errors.length)failed.push(`${skill.name}: ${message}`);
          items.push({id,name:skill.name,status:errors.length?"failed":"success",message,deployments});
        } catch(error) {
          const message=redact(error.message);failed.push(`${skill?.name??id}: ${message}`);items.push({id,name:skill?.name??id,status:"failed",message});
        }
      }
      return {refreshed,unchanged,failed,held_back,items};
    }, mutating: true },
  };
}
