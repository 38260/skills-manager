# Skills Manager 功能性验收

日期：2026-10-12。当前结论：验收进行中，尚未整体验收通过。

## 范围与环境

- Windows，本轮验收使用 `output/playwright/data/home/.skills-manager` 的隔离数据库、来源仓库及部署目录。
- 浏览器通过实际本地服务 `http://127.0.0.1:14219` 访问构建产物；UI 操作与服务端结果分开核对。
- 本轮开始时 `electron/main.mjs`、`package.json`、`package-lock.json` 已有修改，`release/` 未跟踪；这些内容保留，不整体提交。
- 截图位于 `output/playwright/evidence/`；临时测试数据库、来源仓库及运行脚本在验收结束后清理。

## 本轮已通过

| 功能 | 操作与可观察结果 | 证据 |
| --- | --- | --- |
| 分类改名 | 将「验收分类」改为「验收改名」，卡片归类和分类计数一起更新 | 实际 GUI 操作与成功提示 |
| 批量添加 | 多选 alpha、beta，添加「批量验收」，两张卡片同时显示，计数为 2 | 实际 GUI 操作与成功提示 |
| 批量移除 | 在同一批量弹窗移除「批量验收」，两张卡片均去掉分类 | 实际 GUI 操作 |
| 分类删除 | 删除「验收改名」后，三项技能保留，alpha 的 Codex 部署标记保留，未分类筛选显示全部三项 | `output/playwright/evidence/categories.jpg` |
| 空分类新增和持久化 | 新建「空分类验收」，页面刷新后仍存在；点击显示无匹配结果和清除筛选入口 | `output/playwright/evidence/category-empty.jpg` |
| 作者展示 | alpha 显示 metadata.author 的 Alice；beta 显示兼容 author 的 Bob；plain 显示作者未提供 | `output/playwright/evidence/categories.jpg` |
| 基础测试 | `node --test tests/backend/*.test.mjs`：41/41；`npm run test:ui`：2/2；`npm run lint`：通过 | 本轮执行输出，不沿用历史测试结论 |

## 待完成

- 更新入口及移除确认、取消、部署副本内容和关联保留。
- 调用历史 GUI、来源设置、样本采集与真实日志读取；真实客户端新触发场景单独标注。
- 详情页及原有工作区、Preset、备份业务回归。
- Electron 和便携版启动及原生能力。文件协议加载和 preload API 有待复现的问题。
- 最终整体测试、临时内容清理及交付。

## 当前限制

- 后端测试出现一个 SQLite 临时目录 EBUSY 清理提示，业务断言通过；最终清理时复查。
- 构建产物存在不等于桌面端功能正常；不将健康接口通过替代页面和原生能力验收。
