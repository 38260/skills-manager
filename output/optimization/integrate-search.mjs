import fs from "node:fs";
const file="src/views/MySkills.tsx";let text=fs.readFileSync(file,"utf8").replace(/\r\n/g,"\n");
text=text.replace('import { readLibraryViewState', 'import { getSkillDisplayNames, matchSkillSearch } from "../lib/skillSearch";\nimport { readLibraryViewState');
const begin=text.indexOf("  const skillDisplayNames = useMemo(() => {"),end=text.indexOf("  const filtered = useMemo",begin);
if(begin<0||end<0)throw new Error("search display anchor missing");
text=text.slice(0,begin)+"  const skillDisplayNames = useMemo(() => getSkillDisplayNames(skills), [skills]);\n\n"+text.slice(end);
text=text.replace(/      const matchesSearch =[\s\S]*?      if \(!matchesSearch\) return false;/, "      if (!matchSkillSearch(skill, search, displayName)) return false;");
if((text.match(/centralDirName/g)||[]).length===1)text=text.replace(/function centralDirName\(skill: ManagedSkill\) \{[\s\S]*?\n\}\n/,"");
fs.writeFileSync(file,text);
const labels={
  zh:{alias:"匹配别名：{{value}}",name:"匹配原名：{{value}}",directory:"匹配目录名：{{value}}",customDescription:"匹配自定义说明：{{value}}",description:"匹配原描述：{{value}}"},
  en:{alias:"Alias match: {{value}}",name:"Original name match: {{value}}",directory:"Directory match: {{value}}",customDescription:"Custom description match: {{value}}",description:"Original description match: {{value}}"},
  "zh-TW":{alias:"符合別名：{{value}}",name:"符合原名：{{value}}",directory:"符合目錄名：{{value}}",customDescription:"符合自訂說明：{{value}}",description:"符合原說明：{{value}}"},
};
for(const [locale,values] of Object.entries(labels)){
  const file=`src/i18n/${locale}.json`,data=JSON.parse(fs.readFileSync(file,"utf8"));
  data.commandPalette.matchReasons=values;
  data.mySkills.gridView=locale==="en"?"Grid view":locale==="zh-TW"?"網格檢視":"网格视图";
  data.mySkills.listView=locale==="en"?"List view":locale==="zh-TW"?"列表檢視":"列表视图";
  fs.writeFileSync(file,JSON.stringify(data,null,2)+"\n");
}
