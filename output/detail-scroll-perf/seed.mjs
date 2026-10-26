// 为详情滚动性能测量生成一份包含长正文、代码块和表格的隔离技能库。
import fs from "node:fs";
import path from "node:path";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";

const root = path.resolve(process.env.DETAIL_SCROLL_PERF_DATA);
const home = path.join(root, "home");
const source = path.join(root, "source", "detail-scroll-perf");
const profile = process.env.DETAIL_SCROLL_PERF_PROFILE ?? "mixed";
fs.mkdirSync(path.join(home, ".codex", "skills"), { recursive: true });
fs.mkdirSync(source, { recursive: true });

const sections = Array.from({ length: 36 }, (_, index) => {
  const number = index + 1;
  const code = profile === "code"
    ? Array.from({ length: 36 }, (_, line) => `  const row${line} = data[${line}];`).join("\n")
    : [
        `const section = ${number};`,
        "const result = sections.find(item => item.number === section);",
        "console.log(result?.status ?? \"missing\");",
      ].join("\n");
  return [
    `## 第 ${number} 节`,
    "",
    `这是第 ${number} 节的正文，用来模拟真实技能说明中连续的段落、列表和代码。为了测出长页面滚动时的主线程开销，这一节会重复几段内容。`,
    "",
    `第二段继续说明第 ${number} 节的检查步骤。用户通常会在详情面板里连续滚动，查看命令示例、注意事项和结果判断。`,
    "",
    "- 先确认输入文件存在，并检查当前工作目录",
    "- 再运行对应的校验命令，保留完整输出",
    "- 最后核对结果，避免把失败误判成成功",
    "",
    "```ts",
    code,
    "```",
    "",
    "| 项目 | 预期 | 说明 |",
    "| --- | --- | --- |",
    `| section-${number} | ready | 用于滚动性能测试 |`,
    "",
  ].join("\n");
}).join("\n");

fs.writeFileSync(path.join(source, "SKILL.md"), [
  "---",
  "name: detail-scroll-perf",
  "description: 详情滚动性能基线",
  "---",
  "# detail-scroll-perf",
  "",
  sections,
].join("\n"));

const store = new Store({ directory: path.join(home, ".skills-manager"), home });
try {
  store.setSetting("backup_auto_enabled", "off");
  store.setSetting("backup_first_run_prompt", "fresh");
  store.setSetting("sync_mode", "copy");
  store.setSetting("language", "zh");
  store.setSetting("theme", "light");
  const skill = await new Library(store).installLocal(source);
  store.run("INSERT OR IGNORE INTO scenario_skills(scenario_id,skill_id) VALUES(?,?)", store.presets()[0].id, skill.id);
  console.log(JSON.stringify({ directory: store.directory, home, skillId: skill.id }));
} finally {
  store.close();
}
