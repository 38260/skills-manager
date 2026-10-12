// 为 UI 返工验收准备隔离数据：技能库、技能文档（含行内代码/嵌套目录/多文件结构）与调用记录。
// 只写入 output/ui-rework/data，不接触用户真实技能库与日志。
import fs from "node:fs";
import path from "node:path";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";
import { UsageStore, defaultSources } from "../../backend/activity/store.mjs";

const root = path.resolve("output/ui-rework/data");
fs.rmSync(root, { recursive: true, force: true });
const home = path.join(root, "home");
fs.mkdirSync(home, { recursive: true });
for (const tool of [".codex", ".dsh", ".zcode", ".qoder", ".workbuddy"]) fs.mkdirSync(path.join(home, tool), { recursive: true });

const store = new Store({ directory: path.join(home, ".skills-manager"), home });
store.setSetting("backup_auto_enabled", "off");
store.setSetting("backup_first_run_prompt", "fresh");
store.setSetting("sync_mode", "copy");

const document = `---
name: ui-guide
description: 构建清晰、一致、可用的界面，覆盖从 0 到 1 的页面搭建与既有界面统一。
metadata:
  author: 设计团队
---
# UI Guide

## 适用场景

面向日常的界面设计与实现。技能文档默认位于 \`~/.codex/skills/ui-guide/SKILL.md\`，
Codex 与 DSH 会同时读取 \`SKILL.md\`，因此修改后需要重新导入。

- 新建页面与组件
- 优化现有界面的信息层级
- 统一交互与视觉细节

> 先理清信息层级，再统一组件样式。

### 快速开始

1. 把技能放到 \`~/.codex/skills\` 目录。
2. 在设置里把中心库路径改成 \`D:/Skills\`。
3. 运行 \`pnpm build\` 后重启应用。

### 在 Windows 与 macOS 上配置跨平台技能目录与符号链接的完整说明

不同系统的默认目录不同，Windows 使用 \`%USERPROFILE%\\\\.codex\\\\skills\`，
macOS 使用 \`~/Library/Application Support\`。符号链接在 Windows 上需要开发者模式。

## 组件规范

| 组件 | 建议 |
| --- | --- |
| 按钮 | 主次分明，主操作使用 \`accent\` 品牌色。 |
| 表格 | 保持列对齐，控制单元格内边距。 |
| 提示信息 | 使用 \`success\`、\`warning\`、\`error\` 三种类型。 |

## 示例代码

\`\`\`ts
// 定义常用的间距尺度（单位：px）
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;
\`\`\`

## 无语言代码块

\`\`\`
plain code block
\`\`\`

## 更新流程

查看 [Agent Skills 规范](https://agentskills.io/specification) 后执行 \`check_skill_update\`。

## 校验清单

- [x] 布局
- [ ] 视觉验收
`;

const upstream = path.join(root, "upstream");
const skillPath = path.join(upstream, "ui-guide");
fs.mkdirSync(path.join(skillPath, "references"), { recursive: true });
fs.mkdirSync(path.join(skillPath, "scripts"), { recursive: true });
fs.writeFileSync(path.join(skillPath, "SKILL.md"), document);
fs.writeFileSync(path.join(skillPath, "references", "tokens.md"), "# 设计令牌\n\n颜色与间距的统一取值。\n");
fs.writeFileSync(path.join(skillPath, "references", "checklist.md"), "# 验收清单\n\n- 浅色\n- 深色\n");
fs.writeFileSync(path.join(skillPath, "scripts", "build.sh"), "#!/bin/sh\npnpm build\n");
fs.writeFileSync(path.join(skillPath, "LICENSE"), "MIT\n");

const library = new Library(store);
const skill = await library.installLocal(skillPath);
store.setTags(skill.id, ["设计", "UI"]);
// 加入当前 Preset，让详情页右栏的"部署到工具"开关有真实数据（其余未安装工具应被隐藏）。
const presetId = store.activeScenarioId() ?? store.presets()[0].id;
if (!store.activeScenarioId()) store.setActiveScenario(presetId);
store.addSkillToPreset(skill.id, presetId);
store.scenarioSkillTools(presetId, skill.id);
console.log("skill:", skill.id, skill.name, "preset:", presetId);

// 调用记录：覆盖三款工具、三种触发来源与结果状态，全部指向隔离目录内的日志文件。
const activityDirectory = path.join(home, ".skills-manager-activity");
const usage = new UsageStore(activityDirectory);
usage.initialize(defaultSources(home, {}));
const logFile = path.join(home, ".codex", "sessions", "session-demo.jsonl");
fs.mkdirSync(path.dirname(logFile), { recursive: true });
fs.writeFileSync(logFile, '{"type":"demo"}\n');
const now = Date.now();
const rows = [
  { tool: "codex", trigger: "manual", kind: "invocation", status: "returned", evidence: "user_selection", project: "C:/dev/checkout-web", hours: 1 },
  { tool: "codex", trigger: "automatic", kind: "invocation", status: "returned", evidence: "user_auto_choice", project: "C:/dev/checkout-web", hours: 3 },
  { tool: "workbuddy", trigger: "unknown", kind: "document", status: "returned", evidence: "document_read", project: "C:/dev/checkout-web", hours: 6 },
  { tool: "dsh", trigger: "manual", kind: "invocation", status: "failed", evidence: "user_selection", project: "C:/dev/data-pipeline", hours: 26 },
  { tool: "qoder", trigger: "automatic", kind: "invocation", status: "returned", evidence: "user_auto_choice", project: null, hours: 50 },
  { tool: "zcode", trigger: "unknown", kind: "invocation", status: "pending", evidence: "skill_call", project: "D:/Code/CCCode", hours: 74 },
];
for (const [index, row] of rows.entries()) {
  usage.put({
    id: `seed-${index}`, tool: row.tool, skillName: "ui-guide", skillPath: path.join(skillPath, "SKILL.md"),
    timestamp: now - row.hours * 3600_000, sessionId: `session-demo-${index}`, project: row.project,
    callId: `call_${index}`, kind: row.kind, trigger: row.trigger, status: row.status,
    evidence: row.evidence, sourcePath: logFile, sourceLine: String(index + 1),
  });
}
usage.db.prepare("UPDATE sources SET state='ready',lastScan=?,files=1,processed=1,errors=0").run(now);
usage.close();

store.close();
fs.writeFileSync(path.join(root, "fixture.json"), JSON.stringify({
  home, directory: path.join(home, ".skills-manager"), upstream, skillId: skill.id,
}, null, 2));
console.log("隔离数据已准备：", root);
