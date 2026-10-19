# 技能库列表状态徽章修复

- [x] 修复状态徽章被压缩换行，以及状态区内容溢出、重叠。
- [x] 验证不同窗口宽度、长名称、多 Agent、冲突与失败徽章同时出现。
- [x] 完成类型检查、定向静态检查和 Git 增量复查；保留现有暂存内容，不操作暂存区。

范围：只调整技能库列表行布局；保留原有未提交修改，不修改日志证据功能。

## 验证记录

- 修改范围：`src/views/MySkills.tsx` 的列表行布局；未改动网格视图及日志证据功能。
- 状态区从 130px 调整为 360px，并设置最小高度；徽章单行、长文本省略并保留 title。较窄窗口逐步收起作者、标签、调用统计列；1000px 以下允许整行有序换行。
- “原路径丢失”的重新关联、转为本地副本操作改为固定尺寸图标按钮，保留完整 aria-label、title 和原回调；键盘聚焦时操作可见。
- `npx tsc --noEmit -p tsconfig.app.json --incremental false`：通过。
- `npx eslint src/views/MySkills.tsx`：通过。
- `npm run test:ui`：33/33 通过。
- 独立 Vite 构建：通过；未覆盖主任务 dist。保留既有 Browserslist 和包体积提示。
- 实际浏览器测量：1920、1440、1280、1024px 时五类行均约 53.33px；900px 均约 85.33px；820px 均约 89.33px。每种宽度下无行内/状态区重叠，行水平溢出为 0。
- 失败徽章高 24px，保持 nowrap；包含八个 Agent、长预设名与失败/冲突同时出现的情况。
- 证据：`output/status-badge/measurements.json`、`output/status-badge/verified.jpg`。
- 未验证打包后的 Electron 安装包；未执行真实技能更新、重新关联或解绑操作。
- 本次未创建 Git 提交；其他聊天已有暂存内容及原有未提交修改保持原样。
