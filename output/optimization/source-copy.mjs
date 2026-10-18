import fs from "node:fs";
const labels={zh:["读取时间：{{time}}","刷新来源"],en:["Read at: {{time}}","Refresh source"],"zh-TW":["讀取時間：{{time}}","重新整理來源"]};
for(const [locale,[time,refresh]] of Object.entries(labels)) {
  const file=`src/i18n/${locale}.json`,data=JSON.parse(fs.readFileSync(file,"utf8"));
  data.mySkills.sourcePreviewCachedAt=time;data.mySkills.sourcePreviewRefresh=refresh;
  fs.writeFileSync(file,JSON.stringify(data,null,2)+"\n");
}
const file="src/components/SkillDetailPanel.tsx";let text=fs.readFileSync(file,"utf8");
const start=text.indexOf("function SkillDetailPanelContent"),head=text.slice(0,start),body=text.slice(start);
text=head+body.replace('const { t } = useTranslation();','const { t, i18n } = useTranslation();').replace('new Date(activeSourcePreview.cached_at).toLocaleString()', 'new Date(activeSourcePreview.cached_at).toLocaleString(i18n.language)');
fs.writeFileSync(file,text);
