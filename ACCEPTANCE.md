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

## 桌面验收与修复

- 旧构建实际显示空白窗口，CSS／JS 请求落到 `file:///C:/assets/` 并报 `ERR_FILE_NOT_FOUND`；目录选择实际报 `showOpenDialog` 未定义。截图：`output/playwright/evidence/desktop-before.png`。
- 修复为加载本机 HTTP 服务；目录、压缩包、确认和外链通过受控主进程 IPC，校验主窗口与主 frame 来源，外链仅接受 HTTP(S)。安装页和重新关联入口统一使用已有桌面适配层。
- 新构建实际窗口通过 `http://127.0.0.1:14220` 加载；UI 选择文件夹与压缩包后，真实后端分别安装 alpha 与 archive，作者展示正确；目录和文件筛选参数、确认取消值及非法外链拒绝均通过真实 IPC 验证。截图：`output/playwright/evidence/desktop-after.png`。
- OS 文件选择器、消息框和系统浏览器是外部依赖，本次通过主进程测试替身提供返回值；IPC、前端安装及后端业务保持真实执行。未验证实际 OS 弹窗内的人工选择和系统浏览器启动，不把替身验证写成完整原生交互通过。
- 新增 `tests/electron/preload.test.mjs`，覆盖桥接返回值、取消和异常传播。最后后端＋桥接 42/42，UI 4/4，lint、build 通过。
- 便携版独立启动仍未在期限内就绪；桌面 Git 安装在当前受限验收路径报 EPERM。前者无可用错误输出，后者尚未完成根因确认，均不能声明通过。已验证的窗口来自解包构建副本；没有关闭沙箱或修改系统权限。

## 更新验收与修复

- UI 实际执行：本地 alpha 重新导入触发移除确认；取消保留旧正文，确认后作者变为 Alice V2、正文更新、中心与 Codex 副本中的 REMOVE.md 均移除。
- Git 来源通过真实接口安装；修改隔离上游后，UI 检查全部出现一项更新，全部更新成功并刷新作者 Remote V2；卡片单项更新、详情更新均通过。证据：`local-update.jpg`、`remote-update.jpg`、`detail-fixed.jpg`。
- 修复详情「检查并更新」只检查、不更新的行为；使用既有更新命令一次完成，沿用移除确认和编辑保护。已实际点击未预检查的入口并等待第七版正文出现。
- 修复管理页刷新反复触发启动更新检查：在真实页面监听网络，启动检查 1 次，分类保存后仍为 1 次（分别观察 7 秒）。不改变用户自动应用更新偏好。
- API 断言确认 Git 更新后原技能 ID、分类「更新验收」、Default 归属和三条关联历史保留；实际部署的一份 Codex 复制文档与中心逐字节一致。五个 Preset 启用开关不能证明有五份部署。
- 加强已有更新回归：明确使用 copy 模式，同时断言 SKILL.md 与新增 EXTRA.md 的实际副本内容。Windows Git checkout 的 CRLF 按实际中心内容校验，不降低内容一致要求。
- 列表入口、缺失来源的原生重新关联界面和实际 OS 操作未完成 GUI 验收；其余安装、扫描、同步、Preset、项目及备份／冲突／恢复通过本轮真实接口与文件测试，不宣称所有页面都逐一点击过。
