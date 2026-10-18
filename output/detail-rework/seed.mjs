import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";
const root = path.resolve("output/detail-rework/data");
if (fs.existsSync(root)) throw new Error("验收目录已存在，不覆盖已有内容");
const home = path.join(root, "home");
const store = new Store({ directory: path.join(home, ".skills-manager"), home });
for (const tool of [".codex", ".dsh", ".zcode", ".qoder", ".workbuddy"]) fs.mkdirSync(path.join(home, tool), { recursive: true });
store.setSetting("backup_auto_enabled", "off");
store.setSetting("backup_first_run_prompt", "fresh");
store.setSetting("sync_mode", "copy");
const upstream = path.join(root, "upstream");
const skillPath = path.join(upstream, "ui-design");
fs.mkdirSync(skillPath, { recursive: true });
const document = `---
name: ui-design
description: 构建清晰、一致、可用的界面。
metadata:
  author: 设计团队
---
# UI Design

## 适用场景
面向日常的界面设计与实现，帮助你构建清晰、一致、可用的界面。适用于从 0 到 1 的页面搭建，也适用于对现有界面进行优化和统一。

- 新建页面与组件
- 优化现有界面的信息层级
- 统一交互与视觉细节

> 先理清信息层级，再统一组件样式。

## 设计原则
1. 内容优先，减少无效装饰。
2. 操作位置稳定，状态反馈明确。
3. 保持中文排版与组件间距一致。

## 组件规范
| 组件 | 建议 |
| --- | --- |
| 按钮 | 使用清晰的层级区分主次操作，主要操作使用品牌色，次要操作使用中性样式。 |
| 表格 | 保持列对齐，控制单元格内边距，支持排序与空状态提示。 |
| 提示信息 | 按照场景使用成功、警告、错误等不同类型，文案简洁、明确，避免冗长。 |

## 示例代码
\`\`\`ts
// 定义常用的间距尺度（单位：px）
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};
\`\`\`

## 无语言代码
\`\`\`
<section>保持文本安全</section>
second line
\`\`\`

## 长文档验证
${Array.from({ length: 14 }, (_, index) => `### 小节 ${index + 1}\n用于检查滚动定位、长文档目录和固定操作区。\n\n这是一段实际保存到隔离测试文件中的文档内容。`).join("\n\n")}
`;
fs.writeFileSync(path.join(skillPath, "SKILL.md"), document);
const git = args => execFileSync("git", ["-C", upstream, ...args], { stdio: "pipe", windowsHide: true });
git(["init", "-b", "main"]); git(["config", "user.name", "Visual acceptance"]); git(["config", "user.email", "visual@example.invalid"]);
git(["add", "-A"]); git(["commit", "-m", "初始化隔离视觉样本"]);
const library = new Library(store);
const skill = await library.installGit(`file://${upstream.replace(/\\/g, "/")}`);
store.setTags(skill.id, ["UI", "自定义"]);
const preset = store.presets()[0]; store.addSkillToPreset(skill.id, preset.id); store.setActiveScenario(preset.id);
store.scenarioSkillTools(preset.id, skill.id);
for (const tool of ["codex", "deepseek_harness", "zcode", "qoder", "workbuddy"]) {
  if (!store.tools().some(item => item.key === tool)) continue;
  const enabled = ["codex", "deepseek_harness", "zcode"].includes(tool);
  store.setScenarioSkillTool(preset.id, skill.id, tool, enabled);
  if (enabled) await library.deploy(skill.id, tool);
}
fs.writeFileSync(path.join(root, "fixture.json"), JSON.stringify({ home, directory: store.directory, upstream, skillId: skill.id }, null, 2));
store.close();
console.log("隔离视觉样本已创建。");
