# Skills Manager 功能性验收

日期：2026-10-12。结论：验收执行完成，**整体未全部通过**。核心业务与所列 GUI 场景通过；完整桌面交付和五客户端新触发链路仍有未通过或未验证项。

> 2026-10-12 第二轮（详情页与调用记录返工）见文末「第二轮：详情页与调用记录返工」。该轮修复 DSH／WorkBuddy 读取问题、行内代码可读性、目录、项目结构、来源直接打开、部署默认折叠、调用记录内嵌与样式重构，并给出真实浏览器验收证据。

视觉复核补充：详情页样式与项目归档参考图未对齐，视觉还原不通过。现有截图中的分栏与交互检查不能证明参考图样式已实现；返工拆分见 `TODO.md` 第 16 节，本次复核只更新方案和验收口径，未改功能代码。

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

## 未通过或未验证

- 便携版独立启动未在验收期限内就绪，退出后仍没有可用诊断输出；不能声明启动通过。
- 桌面进程在当前受限隔离路径安装 Git 来源报 EPERM，尚未确认完整根因；同一业务在 Node 本地服务的真实接口测试中通过。普通桌面目录环境需补验，不能将接口测试替代此失败场景。
- 实际 OS 弹窗内的目录／文件选择、系统确认与系统浏览器打开，及来源缺失后的完整原生重新关联界面未验证；本次 IPC 的外部 OS 返回值使用测试替身。
- 五款客户端新生成手动／自动记录的全过程未执行。DSH 版本 0 未支持、真实 ZCode 读取失败、WorkBuddy 两条缺名记录已在来源状态中保留限制。

## 当前限制

- 后端测试出现 SQLite 临时目录 EBUSY 清理提示，业务断言通过；最终已关闭相关进程并清理本轮两次运行遗留目录。
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
- 补齐列表视图：标准／兼容／未提供作者展示正确，列表菜单重新导入成功；补齐所选更新：两项中一项更新成功、一项因删除保护保留，摘要明确列出 accept-plain，文件断言确认旧 REMOVE.md 保留。证据：`list.jpg`、`batch-update.jpg`。
- 缺失来源的原生重新关联界面和实际 OS 操作未完成 GUI 验收；其余安装、扫描、同步、Preset、项目及备份／冲突／恢复通过本轮真实接口与文件测试，不宣称所有页面都逐一点击过。

## Windows 文档渲染

- 实际详情中发现 CRLF 的 YAML 前置元数据被当作正文标题显示。修复渲染与目录共用的前置元数据裁剪函数，兼容 LF、CRLF、UTF-8 BOM 和末尾分隔符，不修改技能原文件。
- 新增两个 UI 逻辑测试，覆盖正文与目录行号一致、未闭合元数据及无元数据的缩进保留；UI 测试合计 4/4。
- 更新后的实际详情只显示正文，名称与作者保留在页头，证据见 `output/playwright/evidence/detail-fixed.jpg`。

## 调用记录验收与修复

- 五款工具各自的隔离格式样本通过真实扫描器进入页面：总计 70 条，67 次明确调用、1 次已确认加载、2 条请求；手动 5、自动 4、未知 59 的统计只计调用与已确认加载。
- 重复扫描的 70 个事件 ID、顺序和计数均保持不变；分页显示 1/2 和 2/2。GUI 工具筛选、手动筛选、记录展开、来源编辑、来源缺失提示及恢复扫描通过。
- 从已关联 Codex 记录打开技能详情后发现更新能力缺失、错误显示无来源；改为复用技能库的完整详情入口，保留更新确认、部署与项目能力。详情「调用记录」深链预填技能名称，筛选后显示一条已确认的手动加载。
- 只读扫描本机真实日志共 777 个来源文件，约 16.0 秒，新增 135 条，隔离历史库合计 205 条。Codex 255 文件、Qoder 58 文件读取完成。
- DSH 24 文件中 8 份使用版本 0，当前适配器拒绝未知版本；ZCode 一个真实数据库读取报 `unable to open database file`，未确认更深层根因；WorkBuddy 439 文件中有两条 Skill 调用缺少技能名。三者正确显示部分读取，不将读取问题冒充使用零次。诊断只输出聚合原因，不保存原始对话或工具输出。
- 五款客户端新产生手动／自动记录的全过程没有执行；本轮证据是样本端到端和现存真实日志读取，两者不能替代新触发场景验收。
- 聚合证据：`output/playwright/evidence/activity-summary.json`、`activity-diagnostics.json`；GUI 截图：`history-linked.jpg`、`source-missing.jpg`。

## 启用数量文案

- 验收中发现详情将五个 Preset 启用开关显示为「已同步 5/5」，但实际部署记录只有一份 Codex 副本。
- 将该配置区域改为「已启用」，保留真实部署位置上的同步状态，简中／繁中／英文同步更新。只改展示口径，不修改开关和用户部署目录。
- lint 和前端构建通过；此小改动未单独执行新的原生窗口视觉验收。`detail-fixed.jpg` 保留改文案前的更新验收画面，不能据该图宣称已经部署五份。

## 最终检查、交付与 Git

- 最终自动测试：后端 41 项＋桥接 1 项，42/42；UI 4/4；零失败、零跳过。lint、TypeScript／Vite 构建及 Git 差异检查通过。日志保留在 `output/playwright/tests-final.log`、`build-final.log`、`package-final.log`，不提交完整日志。
- 已关闭本轮浏览器页与桌面测试窗口，结束本轮测试服务，清理隔离数据、CLI 缓存、独立临时目录及调试脚本共 39 项；截图和聚合结果为交付证据，保留并提交。明细见 `output/playwright/evidence/cleanup.json`。
- 桌面 ZIP：`acceptance-release/SkillsManager-Desktop.zip`，约 171 MiB。启动程序、app.asar、本地服务与前端产物结构检查通过；内容来自本轮通过窗口启动测试的解包构建。解压后运行根目录 `Skills Manager.exe`；此包仍受上方未通过／未验证项限制。
- ZIP SHA-256：`E40BA9B833CB86BBCAB377BBFC5222A4989B91695A6D1E87AF042E5D47D8D528`。
- 本轮便携版保留在 `acceptance-release/SkillsManager-Portable.exe` 供后续诊断，未通过启动验收，不作为已验收成品。
- 用户原有 `package.json`、`package-lock.json` 内容哈希与开始时一致；`electron/main.mjs` 保留原有资源路径改动，本轮只提交自己的增量修复；原有 `release/` 保留。打包使用当前工作区配置，这些用户原有打包配置未整体提交。

| Commit | 内容 |
| --- | --- |
| `47ff3dc` | 分类、作者验收与任务拆分 |
| `2023aab` | 桌面白屏与原生能力 IPC 修复 |
| `a5a3c20` | 详情一步更新、启动检查及复制副本回归 |
| `5d90ac1` | Windows Markdown 元数据与目录修复 |
| `68690fb` | 调用记录完整详情与真实来源结果 |
| `a5878f3` | Preset 启用数量口径 |

最终证据与报告提交通过 `git log -- ACCEPTANCE.md TODO.md output/playwright/evidence` 查询。交付报告不代表上方未通过项完成。

## 第二轮：详情页与调用记录返工（2026-10-12）

范围：技能详情页可读性与信息组织、调用记录内嵌与样式、以及真实日志的读取缺陷。使用隔离数据 `output/ui-rework/data`，不接触用户真实技能库；真实日志仅只读复扫。

### 1. 读取缺陷修复（后端）

| 问题 | 根因 | 修复与复核 |
| --- | --- | --- |
| DSH「8 个读取问题」 | `parseDsh` 只接受日志版本 1–4，本机 24 份会话中 8 份为 `version: 0`，整份文件被拒 | 版本白名单加入 0（v0 的 `data.name`／`data.callId`／`tool/result` 结构与 v4 一致，已解压核对）；未知版本仍报错，`version: 999` 断言保留 |
| WorkBuddy「2 个读取问题」 | Skill 工具参数键随版本变化，2 条历史记录使用 `{"command":"skill-creator"}`，只读 `arguments.skill` 时名称缺失并被计为解析问题 | 名称解析改为 `skill ?? command`；名称确实缺失时仍按解析问题上报，不伪造技能名 |
| 修好解析器后提示仍不消失 | `scanned_files` 缓存了每个文件的错误计数，文件内容未变时扫描器直接复用旧计数（`errors += previous.errors`），所以旧版本的错误数会一直残留，来源永远停在「部分读取」 | 缓存增加 `parser_version` 列（旧库自动补列，默认 0），解析器版本不一致的文件强制重读一次；解析器版本常量 `PARSER_VERSION` 在修复解析缺陷时递增 |

真实日志只读复扫结果：

- 全新缓存：DSH 24 文件、WorkBuddy 440 文件，问题文件 8 → 0、2 → 0，两来源状态均为 `ready`。
- 旧库升级路径（模拟用户现状）：把缓存错误计数写成 24／440 并删掉 `parser_version` 列，用新版本重新打开后扫描一次，错误数降为 **0**、状态回到 `ready`、`detail` 清空。
- 五款来源最终状态：codex 255 文件 / dsh 24 / zcode 1 / qoder 58 / workbuddy 440，全部 `ready`、错误 0，共 147 条记录。**因此界面上的黄色「部分读取 · N 个读取问题」在重启应用并完成一次扫描后不再出现。**

新增单测：`tests/backend/activity-dsh.test.mjs`（版本 0 解析）、`tests/backend/activity-workbuddy.test.mjs`（command 键且 `ctx.errors` 为 0）、`tests/backend/activity-scanner.test.mjs`（解析器升级后旧缓存失效并重读、来源恢复 `ready`）。

### 2. 新增后端能力

- `get_skill_files`：返回技能中心库副本的目录结构（相对路径、是否目录、字节数），不返回文件内容；忽略项与 `files()` 一致。
- `open_path`：用系统默认程序打开文件／目录，`reveal` 时在文件管理器中定位。路径限定在技能库目录、已纳管技能的中心库与本地来源目录、调用记录来源目录之内；传入 `skillId` 时按技能目录相对路径解析。白名单外的路径被拒绝（`tests/backend/shell.test.mjs` 覆盖拒绝与不存在两种情况）。

### 3. 前端改动与真实浏览器验收

验收方式：单进程脚本自行拉起本地服务与 headless Chrome（`output/ui-rework/verify.mjs`），跑完一并结束；脚本与截图保留在 `output/ui-rework/`。

| 需求 | 验收断言 | 结果 |
| --- | --- | --- |
| 行内代码看得清 | 浅色：文字 `rgb(4,120,87)` / 底 `rgba(5,150,105,0.08)` / 边 `rgba(5,150,105,0.25)`；深色：文字 `rgb(52,211,153)` | 通过 |
| 无语言标记代码块 | `pre` 内不再出现绿色行内标签（`inlineChipInsidePre: false`） | 通过 |
| 目录优化 | 8 个条目；超长中文标题折行为 2 行（`line-clamp: 2`），不再截断 | 通过 |
| 项目结构 | 详情右栏出现「项目结构」，列出 `LICENSE`、`SKILL.md`、`references/`、`scripts/` 及子文件与体积 | 通过 |
| 查看来源直接打开文件 | 点击结构中的 `SKILL.md` 发出 `open_path { skillId, relative: "SKILL.md" }`；点击目录行不发出请求（反向断言） | 通过 |
| 来源位置 | 「打开来源目录」发出 `open_path { path: <上游目录>, reveal: false }` | 通过 |
| 部署默认折叠 | 初始 `aria-expanded=false`，折叠时开关数为 0；展开后只出现已安装工具（Codex／Qoder／ZCode／WorkBuddy／DeepSeek Harness），未安装工具与「N 个不可用」入口均不展示 | 通过 |
| 调用记录内嵌 | 切到「调用记录」页签后 `location.pathname` 仍为 `/my-skills`；内嵌 6 条记录；展开后展示识别依据／行号／会话 ID／调用 ID／项目／技能文件／来源文件 | 通过 |
| 调用记录页样式 | 记录区无大圆角卡片（`rounded-xl` 计数 0）；统计为扁平数字行；6 条记录 | 通过 |
| 调用记录对齐参考图（浅色 + 深色） | 每行以工具图标起头（与参考图右栏工具行一致）；展开态为浅绿底 + 3px 左侧绿线（与参考图"目录"选中态一致）。深色断言：展开底 `rgba(16,185,129,0.08)`、左线 `rgb(16,185,129)` / 3px；浅色断言徽章与正文对比度正常 | 通过 |
| 近期动态含调用记录 | 仪表盘「近期动态」共 7 行：1 条技能更新 + 6 条调用记录；6 行含工具名与触发方式徽章；每行均有时间；区块右上角有「查看全部」 | 通过 |
| 详情页页头缩小与滚动紧凑化 | 顶部：页头 160px、标题 22px、图标与描述可见、操作按钮 32px；正文下滑后：页头 110px、标题 17px、图标与描述隐藏、按钮 28px；回到顶部还原为 160px。浅色与深色均核对 | 通过 |
| 技能信息可编辑（别名／说明／作者） | 卡片菜单与详情页页头均可打开「编辑技能信息」；把 `playwright` 设为别名「浏览器自动化」、自定义说明与作者「自动化小组」后，卡片与详情页头立即显示，并标注「原名: playwright」「· 自定义」；清空保存后完全还原 | 通过 |
| 调用次数与最后使用时间 | 52 张卡片中 27 张显示「调用 N 次 · 最后使用 日期」、25 张显示「从未使用」，与后端统计一致 | 通过 |
| 筛选单选不组合 | 点「学术科研」筛出 6 张；再点来源「本地」后变为 52 张（分类筛选被清空），来源 chip 处于选中态、分类 chip 取消选中；反向操作同样成立 | 通过 |

截图证据：`output/ui-rework/evidence/`（`01_detail_light`、`01b_detail_sidebar_bottom`、`02_activity_inline`、`03_activity_detail`、`04_detail_dark`、`05_activity_page_light`、`05b_activity_page_light_detail`、`06_activity_deeplink`、`07_dashboard_light`、`08_activity_inline_dark`、`09_activity_detail_dark`、`10_activity_page_dark`、`11_activity_page_dark_detail`、`14_header_compact`、`14b_header_compact_dark`）；结构化断言见同目录 `report.json`。

### 3.1 「打开文件」无法打开（第三轮修复）

现象：点击项目结构中的文件或「打开文件」后没有任何反应。

根因（有硬证据，非推测）：

1. 桌面外壳用 `ELECTRON_RUN_AS_NODE=1` 拉起本地服务（`electron/main.mjs`），该变量会被本地服务继续传给被打开的程序。
2. 本机 `.md` 的默认打开方式是 Typora（`HKCU\...\FileExts\.md\UserChoice` → `md_auto_file` → `D:\Apps\Typora\Typora.exe`），Typora 是 Electron 应用。
3. 用工程内 `electron.exe` 实测同一脚本在两种环境下的差异：
   - 带 `ELECTRON_RUN_AS_NODE=1`：`process.type` 为空、`require('electron')` 抛「Cannot find module 'electron'」——即被当作普通 Node 运行，Electron 应用无法创建窗口。
   - 不设置该变量：`process.type = "browser"`、`require('electron').app` 可用——正常 Electron 应用。
   因此 Typora 被拉起后立即以 Node 模式失败，表现为「点了没反应」。

修复：

- 打开外部程序前清理 Electron 注入的环境变量（`ELECTRON_RUN_AS_NODE`、`ELECTRON_NO_ATTACH_CONSOLE`、`ELECTRON_FORCE_IS_PACKAGED`、`ELECTRON_ENABLE_LOGGING`、`SKILLS_MANAGER_ROLE`），且不改动传入对象本身。
- 打开方式改为按目标类型与平台生成候选序列，失败才回退：Windows 定位文件用 `explorer.exe "/select," <路径>` 两个参数（合并成一个参数在路径含空格时会被引号包裹，explorer 解析失败）；目录先用文件管理器打开；文件先交给系统默认程序，失败回退为在文件夹中定位。
- 等待子进程真正建立（`spawn`）或明确失败（`error`），不再静默吞掉启动错误；失败时把真实原因返回给界面展示。

新增单测：`launchEnv` 清理变量且不修改入参、`launchPlan` 的四种平台/类型组合、`pathWithinRoots` 的边界。`tests/backend/shell.test.mjs` 4/4 通过。

未验证项：本机工具环境无法启动桌面程序（分离进程被回收），因此「修复后 Typora 实际弹出窗口」这一步需用户在本机确认；已验证的是环境变量差异（硬证据）、候选命令形状与错误上报链路。

### 4. 测试与静态检查

- 后端：`node --test tests/backend/*.test.mjs` 45 项，通过 43，失败 2。
- UI：`node --experimental-strip-types --test tests/ui/*.test.mjs` 6/6 通过。
- `npm run lint`、`tsc -b`、`vite build` 通过。

### 5. 未通过项与限制

- 失败 2 项为 `tests/backend/backup.test.mjs`、`tests/backend/update-regression.test.mjs`，错误均为 `spawnSync git EBUSY`。独立复核确认这是本机环境限制：`spawnSync` 派生任何进程（含 `where`、绝对路径 `git.exe`）均报 EBUSY，而异步 `spawn('git')` 正常返回版本号；本轮未修改任何 Git 相关代码，与本次改动无关。这两项仍需在可同步派生进程的环境复跑。
- 「调用记录」页签内嵌列表按技能名匹配，同名不同来源的技能会同时命中；未关联到纳管技能的记录在该页签不展示，需到调用记录页查看。
- 详情页右栏在「目录 + 项目结构 + 部署（展开）+ 来源信息」同时存在时内容高度约 1163px、可视区约 688px，需要滚动；默认折叠部署后显著变短，但未做进一步的折叠策略。
- 未重新执行桌面原生窗口、便携版启动与五客户端新触发链路验收，结论沿用上一轮未通过项。


## 第二轮补充：技能库管理能力（2026-10-12）

| 需求 | 实现与断言 | 结果 |
| --- | --- | --- |
| 支持管理现有技能（如修改作者） | 新增 `set_skill_profile`：写入 `skills.alias` / `custom_description` / `author_override`（旧库启动自动补列），同步 sidecar 元数据；**不改动 SKILL.md 与已部署副本**，清空即回退。界面为「编辑技能信息」对话框，入口在卡片「更多操作」与详情页页头 | 通过 |
| 调用次数与最后使用时间 | 新增 `get_skill_usage`：按已纳管技能聚合非请求记录，匹配策略「严格路径 → 名称唯一时按名称」。真实数据 52 技能中 27 有记录、25 显示「从未使用」 | 通过 |
| 展示别名与自定义说明 | 卡片与列表显示别名（原名作次级提示）、自定义说明、作者（自定义标注）；详情页页头同步 | 通过 |
| 筛选单选不组合 | 来源与分类筛选互斥，点一个清另一个 | 通过 |

证据与复核方式：`output/skill-manage/preview.mjs` 用**真实技能库 + 隔离 home**（调用记录库为真实库的副本，不写用户原文件）起服务与 headless Chrome。编辑验证采用「写入 → 断言 → 清空 → 断言还原」往返，复核结束后复核 `SELECT ... WHERE alias IS NOT NULL OR custom_description IS NOT NULL OR author_override IS NOT NULL` 为 **0 条**，技能库回到原状。截图：`output/skill-manage/evidence/`（卡片统计、单选筛选、编辑对话框、保存后、详情页、深色）。

测试：后端 50 项 48 通过（2 项仍为本机 `spawnSync` 派生进程 EBUSY，与本次改动无关）、UI 6/6、lint、类型检查与构建通过。新增测试覆盖「自定义信息优先展示且清空回退」与「调用统计次数／最后使用时间、同名技能不猜测归属」。

限制：作者等信息的编辑是**展示层覆盖**，不会改写 SKILL.md，因此 Agent 侧看到的仍是原文件内容；若需要真正改写技能文件，需另做（涉及已部署副本的同步与编辑保护）。

## 第三轮补充：六项稳定性修复（2026-10-18）

范围：备份冲突保留两份、安装失败回滚、取消安装、浏览器模式重启、自动检查、快照空间管理。每项独立提交。

验证结果（隔离数据，本机 Windows）：

1. 备份冲突：回归测试覆盖「远端新增中文目录 `参考资料/说明.md`、改写二进制 `图片.bin`」→ `keep_both` 后副本内容与远端逐字节一致，本地版本保持不动，冲突项清零并可继续推送。
2. 安装回滚：注入 `saveManifest` / `saveMetadata` 失败，断言数据库记录 0 条、技能目录不存在、清单与元数据目录为空；恢复后重装只有一份技能。
3. 取消安装：无进行中安装时返回 `false`（已完成），缺参数返回结构化错误；前端按三种结果分别提示。
4. 浏览器模式重启：真实进程探针确认旧进程退出、新进程按原参数拉起、`/api/health` 与接口在重启后恢复，且 `restart_app` 返回 `{"ok":true}` 而非连接重置。
5. 自动检查：`eslint .` 0 问题（此前 backend/electron/tests 完全未覆盖）；后端 87/87、UI 18/18、Electron 桥接 1/1 通过；两个过时 Preset 测试按现行语义重写。
6. 快照空间管理：真实浏览器（无头 Chrome，隔离库，1 个技能 3 个快照）断言面板显示「共 3 个快照 · 1 个技能 · 占用 5.5 KB」、筛选下拉 2 项、保留份数 4 档（默认 2），清理预览弹出「将删除 1 个旧快照，回收约 1.8 KB；每个技能仍保留最近 2 个恢复点」并列出明细；页面无错误提示。

未做：便携版与真实客户端交互验收、GitHub Actions 实跑（本轮只改工作流，未触发远端）。
