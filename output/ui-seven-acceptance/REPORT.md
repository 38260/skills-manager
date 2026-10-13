# 七项 UI 交互独立验收报告

日期：2026-10-13。结论：**5 项通过、2 项未通过，暂不整体通过。**

本轮未修改产品代码。使用当前完整前端构建、真实 React 组件／路由／通信逻辑与可控本地 API 替身，模拟慢请求、同 ID 记录变更和来源故障。没有连接真实技能数据库，也未执行真实删除。测试起点 Git 为 `d41487d`，工作区已有修改仍保留。

## 逐项结果

| 项 | 结果 | 实际检查 |
| --- | --- | --- |
| 1 确认框执行锁 | **失败** | 技能库单项删除确认后，API 保持挂起，卡片仍显示忙状态，但确认框已关闭 |
| 2 详情跟随最新记录 | 通过 | `e1` 从等待／手动／旧依据变为已返回／自动／新依据，且后端重排列表；选中项仍为 `e1` |
| 3 来源失败可恢复 | 通过 | 原文和差异均显示模拟失败原因与重试；显式重试、失败后切页签重读成功；成功后切页不增加请求次数 |
| 4 查询与刷新反馈 | 通过 | 调用记录筛选挂起时保留 3 行、`aria-busy=true`、显示“正在更新结果…”；工作区首屏显示骨架，同 Agent 刷新保留 1 行并显示“正在刷新列表…” |
| 5 键盘与行内操作 | 通过 | 标题原生按钮可用 Enter、Space 打开；列表中 Tab 到上传按钮后，操作组稳定透明度为 1，键盘焦点留在卡片中 |
| 6 弹层焦点圈定 | **失败** | 初始焦点在面板 `DIV role=dialog`；首次 Shift+Tab 后跑到背景“删除本地 Skill”按钮。Esc、焦点返回和关闭按钮处的回绕分别通过 |
| 7 徽章颜色一致 | 通过 | 手动／自动／未知三种徽章，表格与右侧详情的文字、背景、边框计算颜色均一致 |

## 必须修复的两项

### 1. 单项删除的调用者未等待任务

入口：`src/views/MySkills.tsx:2035` 调用 `handleDeleteSkill`。该函数在 `594–619` 行用 `void (async () => { ... })()` 启动任务，立即返回；外层 `onConfirm` 的 async 包装同样没有等待任务。因此 `ConfirmDialog` 把回调误判为完成并执行 `onClose()`，自身的 `loading` 守卫无法锁到实际删除结束。

复现：打开技能库 audit-demo 的“更多操作 → 删除 → 删除”；API 替身保持删除请求不返回。`a1-backend-held.json` 中 `held` 含 `holdDelete`，同时浏览器确认框按钮为 0、确认标题不可见、卡片忙状态为 true。

建议最小修复：让 `handleDeleteSkill` 返回真正的 Promise，并让 `onConfirm` 返回或等待该 Promise。保留现有删除保护、错误反馈、忙状态及刷新安排。

证据：`a1-delete-running.jpg`、`a1-backend-held.json`、`result.json` 的 A1。

### 6. 初始面板焦点不在反向 Tab 的边界条件中

位置：`src/components/DetailSheet.tsx:62`。打开时 `panel.focus()` 将焦点落在面板本体；面板包含自身，所以 `inside=true`，但它不是 `first`。首次 Shift+Tab 因此不进入拦截分支，浏览器把焦点移到面板之前的背景删除按钮。

复现：用键盘 Enter 打开 workspace-demo 文档，立即 Shift+Tab。初始 `activeRole=dialog, inside=true`；随后 `activeTitle=删除本地 Skill, inside=false`。不要用“关闭按钮处 Shift+Tab 能回绕”替代此初始边界。

建议最小修复：反向 Tab 守卫也处理 `document.activeElement === panel`，转移到最后一个可聚焦项；继续复查 Esc、焦点返回及嵌套弹层。现有代码刻意避免全局 inert，不建议直接禁用整个 `#root`。

证据：`a6-first-shift-tab.jpg`、`result.json` 的 A6initial／A6shift／A6escape／A6wrap。

## 保留的检查时序结果

A5 行内操作有透明度过渡。第一次在动画过程中读到 `0.694997`，“完全显示等于 1”的即时断言失败；保持同一键盘焦点，过渡结束后按同一标准复查为 `1`。两次记录都保留在 `result.json` 的 A5focusInitial／A5focusStable 中，没有修改产品或降低断言。A5 最终按稳定交互状态判定通过。

来源检查首先使用一次性故障，该故障在读到失败文案前已被重新读取并恢复。随后使用持续故障稳定验证失败原因及按钮，待外部服务恢复后才点击重试；失败状态截图保留。这个模拟过程不代表实际 Git 仓库或网络服务已经通过验收。

## 自动检查与证据

- `npm run build`（含 TypeScript）：通过。
- `npm run test:ui`：6/6。
- `npm run lint`：通过。
- `result.json`：DOM、焦点、颜色、选择与加载检查结果；原始失败记录保留。
- `backend-evidence.json` 及 A1／A3 文件：接口请求次数和可控请求状态。
- JPG 截图：删除仍进行、刷新后详情、来源失败／恢复、查询进度、工作区骨架／刷新、键盘动作、首次反向 Tab 和徽章。
- 规范参考：[Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md)。本轮发现依据具体运行结果，不是仅凭规范或源码判定。

## 验证范围

- 构建产物为 `dist/assets/index-PbOmMip3.js`；相关修复文件修改时间早于本轮构建。
- 徽章在浅色、1536 × 960 视口验证；本轮不宣称深色、触屏或屏幕阅读器全面通过。
- A4 首屏骨架检查针对工作区；调用记录首屏仍沿用加载提示。本轮未把这项当作“两页首屏都改成骨架”的验收。
- 没有重新验收实际删除／上传／拉取、真实 Git 上游读取、全部确认框调用点、Electron 或便携版行为。
- `git_backup_pending_conflicts` 和 `fetch_leaderboard` 不在本轮范围，替身的未覆盖接口列表保留；不宣称备份或市场通过。
- 之前 `output/ui-polish/result.json` 的脚本结果仅为历史证据，不能抹去本轮 A1 与 A6 的失败。

主 `AGENT_TODO.md` 的 F1、F6、F8 已恢复为未完成。验收执行结束，建议先修 1 和 6，再复跑对应实际调用链。
