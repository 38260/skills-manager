# 记录详情 · 上下文与命中内容换位验收

交付日期：2026-10-19。用真实会话文件（目标行 ±2）在无头 Chrome 下验证。

## 改动

- 记录详情里的证据卡片顺序改为：**查看上下文 → 命中内容 → 查看原始记录**（原来顺序是 命中内容 → 查看上下文 → 原文）。
- 上下文改为**默认展开**：打开一条记录就能看到命中前后的用户消息 / Agent 调用 / 工具返回 / Agent 回复。
- 上下文用受控 `details` + 状态承接 `open`，用户手动收起后，复制按钮等引起的重渲染不会把它弹开。
- 命中内容、复制按钮、原文折叠块的内容与行为都不变。

## 验收

| 检查 | 结果 |
| --- | --- |
| 两个折叠块（上下文 / 原文） | 2 个 |
| DOM 顺序 | 查看上下文 → 命中内容 → 查看原始记录 |
| 默认展开状态 | 上下文 `open=true`，原文 `open=false` |
| 上下文解析出的角色 | 用户消息 / Agent 调用（当前记录）/ 工具返回 / Agent 消息 共 4 条 |
| 点标题收起 | 高度 40px，`open=false`，命中内容不受影响 |
| 再次展开 | `open=true` |
| 单测（`tests/ui/activity-evidence-render.test.mjs`） | 1/1（含顺序与默认展开断言） |
| 后端 / UI / Electron | 130/130、38/38、1/1 |
| 构建 / ESLint | 通过 |

浏览器实测 12/12，脚本：`node output/evidence-order/verify.mjs run`，报告见 `output/evidence-order/evidence/run/report.json`。

## 截图

- [默认展开上下文（浅色）](output/evidence-order/evidence/run/01_default_open.png)
- [默认展开上下文（深色）](output/evidence-order/evidence/run/02_default_open_dark.png)

## 边界

- 上下文展开后高度较大，命中内容会被推到下方，需要在右侧面板内滚动（面板本身已可独立滚动）。
- 无相邻消息时显示「没有可用的上下文」占位，不额外补空行。
- 原测试「原文和上下文默认折叠」改为「上下文默认展开、原文折叠」，属于需求变更后的断言更新，未放宽其它校验。
