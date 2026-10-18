import fs from "node:fs";
const keys=["retrying","retryFailed","closeResults","resultsSummary","completed","batchDeleteResults","batchTagsResults","batchEnableResults","batchDisableResults","batchDeployResults","selectedUpdateResults","allUpdateResults","libraryUpdated","heldUpdate","refreshFailed","deploymentResultsTitle","deploymentFailures","viewResults"];
const copy={
  zh:["正在重试…","仅重试失败项（{{count}}）","关闭结果","成功 {{success}} · 失败 {{failed}} · 待确认 {{held}}","已完成","批量删除结果","批量分类结果","批量加入 Preset 结果","批量移出 Preset 结果","批量部署结果","所选技能更新结果","全部技能更新结果","中央库已更新","存在本地编辑或文件移除，请单项更新并确认","操作已完成，列表刷新失败，请刷新页面查看最新状态","{{name}}：中央库已更新 · Agent 同步结果","中央库已更新，{{count}} 个 Agent 同步失败","查看结果"],
  en:["Retrying…","Retry failed items ({{count}})","Close results","Succeeded {{success}} · Failed {{failed}} · Needs approval {{held}}","Completed","Batch deletion results","Batch category results","Add to Preset results","Remove from Preset results","Batch deployment results","Selected skill update results","All skill update results","Library updated","Local edits or removed files need approval. Update this skill individually.","Actions completed, but lists could not refresh. Refresh the page for the latest state.","{{name}}: library updated · Agent deployment results","Library updated; {{count}} Agent deployments failed","View results"],
  "zh-TW":["正在重試…","僅重試失敗項目（{{count}}）","關閉結果","成功 {{success}} · 失敗 {{failed}} · 待確認 {{held}}","已完成","批次刪除結果","批次分類結果","批次加入 Preset 結果","批次移出 Preset 結果","批次部署結果","所選技能更新結果","全部技能更新結果","中央庫已更新","存在本機編輯或檔案移除，請單項更新並確認","操作已完成，列表重新整理失敗，請重新整理頁面查看最新狀態","{{name}}：中央庫已更新 · Agent 同步結果","中央庫已更新，{{count}} 個 Agent 同步失敗","查看結果"],
};
const recovery={
  zh:{title:"技能恢复",hint:"更新和删除前自动保存技能快照，可恢复单个技能。恢复会保留当前版本，并保护 Agent 副本里的本地改动。",empty:"暂无技能快照，更新或删除技能后会在这里显示。",beforeDelete:"删除前",beforeUpdate:"更新前",beforeRestore:"恢复前",deleted:"已删除",files:"{{count}} 个文件",restore:"恢复",restored:"技能已恢复",partial:"技能已恢复，部分 Agent 副本需要处理",savedCurrent:"恢复前的版本已另存为快照，可随时恢复。",confirmTitle:"恢复技能快照",confirm:"恢复「{{name}}」到所选快照？当前版本会另存快照，Agent 副本里的本地改动会保留。"},
  en:{title:"Skill recovery",hint:"Snapshots are saved before updates and deletions. Restore one skill while preserving its current version and local edits in Agent copies.",empty:"No snapshots yet. Update or delete a skill to create one.",beforeDelete:"Before deletion",beforeUpdate:"Before update",beforeRestore:"Before restore",deleted:"Deleted",files:"{{count}} files",restore:"Restore",restored:"Skill restored",partial:"Skill restored; some Agent copies need attention",savedCurrent:"The previous current version was saved as another snapshot.",confirmTitle:"Restore skill snapshot",confirm:"Restore {{name}} to this snapshot? Its current version will be saved and local edits in Agent copies retained."},
  "zh-TW":{title:"技能復原",hint:"更新和刪除前自動儲存技能快照，可復原單一技能。復原會保留目前版本，並保護 Agent 副本的本機改動。",empty:"尚無技能快照，更新或刪除技能後會在這裡顯示。",beforeDelete:"刪除前",beforeUpdate:"更新前",beforeRestore:"復原前",deleted:"已刪除",files:"{{count}} 個檔案",restore:"復原",restored:"技能已復原",partial:"技能已復原，部分 Agent 副本需要處理",savedCurrent:"復原前版本已另存為快照，可隨時復原。",confirmTitle:"復原技能快照",confirm:"將「{{name}}」復原到所選快照？目前版本會另存快照，Agent 副本的本機改動會保留。"},
};
for(const [locale,values] of Object.entries(copy)) {
  const file=`src/i18n/${locale}.json`,data=JSON.parse(fs.readFileSync(file,"utf8"));
  data.optimization=Object.fromEntries(keys.map((key,i)=>[key,values[i]]));data.mySkills.recovery=recovery[locale];
  data.mySkills.deleteConfirm=locale==="en" ? "Delete skill {{name}}? A recovery snapshot will be saved first. Library files, Preset membership and unedited Agent copies will be removed; edited Agent copies are retained."
    : locale==="zh-TW" ? "刪除技能「{{name}}」？刪除前會儲存復原快照；中央庫檔案、Preset 關聯與未編輯的 Agent 副本將移除，已編輯的副本會保留。"
    : "删除 Skill「{{name}}」？删除前会保存恢复快照；中央库文件、Preset 关联和未编辑的 Agent 副本将移除，已编辑的副本会保留。";
  data.mySkills.batchDeleteConfirm=locale==="en" ? "Delete {{count}} selected skills? Each skill will have a recovery snapshot saved before deletion; edited Agent copies are retained."
    : locale==="zh-TW" ? "刪除所選 {{count}} 個技能？每項刪除前均儲存復原快照，已編輯的 Agent 副本會保留。"
    : "删除所选 {{count}} 个 Skill？每项删除前均保存恢复快照，已编辑的 Agent 副本会保留。";
  fs.writeFileSync(file,JSON.stringify(data,null,2)+"\n");
}
const file="src/views/MySkills.tsx";let text=fs.readFileSync(file,"utf8");
for(const [i,key] of keys.entries())if(i>=4&&i<=14)text=text.split(JSON.stringify(copy.zh[i])).join(`t("optimization.${key}")`);
text=text.replace('`${skill.display_name || skill.name}：中央库已更新 · Agent 同步结果`','t("optimization.deploymentResultsTitle", { name: skill.display_name || skill.name })').replace('`中央库已更新，${failed.length} 个 Agent 同步失败`','t("optimization.deploymentFailures", { count: failed.length })').replace('label: "查看结果"','label: t("optimization.viewResults")');
fs.writeFileSync(file,text);
