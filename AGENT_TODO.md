# Agent 工作 Todo

> 工作约定：每个「小功能」独立完成 → 跑静态检查（`npx tsc --noEmit` + `npm run build`）→ **提交一次 Git** → 回到这里勾选。
> 提交时只带该小功能相关文件，不捆绑用户自己的 WIP。

---

## 进行中

（暂无）

---

## 已完成

### ✅ README 重写 + 截图改为虚构演示数据（2026-10-12 第四轮）

**背景**：用户要求「README 重写，截图用我现有的真实项目的截图」。照做之后立刻被用户叫停 ——
用真实技能库出的图里含**真实技能名、本机路径、真实调用记录**，README 是公开的。已全部删除并重做。

- [x] **删除**所有真实数据截图（`assets/screenshots/` 整目录）与含真实数据副本的夹具
      （`output/{readme-shots,page-perf,ui-contrast,startup-perf}/data`、`output/page-perf/evidence`、
      `output/ui-contrast/evidence/{real-*,baseline,after-color*}`）
- [x] 新增演示数据与出图脚本：`output/readme-shots/seed-demo.mjs`（纯虚构：9 个示例技能 / 6 个 Agent /
      2 个项目 / 68 条调用记录，写在隔离目录 `D:/sm-demo`）+ `shoot.mjs`（浅色主题逐页出图）
- [x] `.gitignore` 增加护栏：`output/ui-contrast/evidence/real-*`、`output/page-perf/evidence`，
      并写明「README 截图必须用 seed-demo 的演示数据」的注释
- [x] README 全文重写：新增「界面」一节（8 张图：工作台 / 调用记录 / 技能详情 / 全局工作区 /
      安装 Skills / 备份 / 设置 + 技能库作首图），并注明截图使用虚构演示数据、可复现
- [x] 替换上游遗留的三张 `diagram-*.png`（深色、英文，且 concept-map 仍写着本分支已删除的
      Preset「Apply (one-time write)」）→ 改成 README 内联 **Mermaid**（工作区模型 + 调用链路）
- [x] 事实刷新：`electron/main.mjs` 155 行 + `splash.html`、测试 后端 19 / electron 1 / 前端 3、
      asar 只装 `dist/` + `electron/` + `package.json`（约 1.5MB）
- [x] 校验：README 引用的 9 个图片全部存在；README 文本与文件名无用户名 / 本机路径 / 项目名
- [ ] 未提交 Git（同前：`electron/main.mjs`、`package.json` 混着用户自己的打包 WIP）

⚠️ **需要用户决定**：更早的会话**已经提交**的验收截图含真实数据（`output/ui-rework/evidence/*`
可看到真实技能名与本机路径，另有 `skill-manage` / `skill-classify` / `playwright` 的 evidence）。
它们已在 git 历史里，工作区删除只能阻止后续版本继续带。

### ✅ 修复：界面「颜色发灰」——先把灰量化，再改配色（2026-10-12 第三轮）

**背景**：上午那轮「浅色重建层次」是为了让卡片与页面分得开，做法是把页面底压到 `#F1F1F4`、边框提到
1.3:1 —— 拿整屏变灰换层次，于是用户第二次反馈「颜色发灰」。这轮先量化再动手。

**先确认用户看的是哪套主题**：库里 `theme='system'`，而本机 Windows 是浅色
（`AppsUseLightTheme=1`）→ **用户看到的是浅色主题**，不是默认的 dark。

**量化（新增 `output/ui-contrast/shot-real.mjs`：真实数据 + 无头截图 + 像素统计）**：

| 指标 | 改动前 | 改动后 |
| --- | --- | --- |
| 中性灰像素占比（饱和度 <6%） | 93.9%–95.8% | 91.9%–93.5% |
| 平均饱和度 | 0.023 | 0.032 |
| 出现最多的颜色 | `#F8F8F8` 44% + `#F0F0F0` 31%+ | `#F8F8F8` 58% + `#F0F8F8` 29%（冷调） |

**根因两条**：① 上一轮是把页面压灰来换层次；② 卡片里 5 行文字有 3 行是最轻的两档灰
（`#65656E`/`#70707A`），压在近白底上发飘 —— 屏幕上「灰」的主要来源其实是字，不是底。

- [x] 浅色 token 重建：页面底 `#F6F8FC`（接近白的冷灰）、侧栏 `#FAFBFE`、hover `#EDF1F9`、
      active `#E1E8F4`、边框 `#C1CBE0`/`#D2DAEA`/`#E5E9F4`、阴影加实 —— **层次交给边框 + 阴影**，
      边框对页面 **1.32**（改动前 1.30，不但没退，还更强）
- [x] 文字阶梯压深一档并统一冷色相：`#151A27` / `#2A3346` / `#3D4A63` / `#4E5A75` / `#5E6A85`
- [x] 选中态改用品牌绿（依据用户自己的效果图 `assets/Dashboard.png`：侧栏当前项就是绿色胶囊）：
      `Sidebar.tsx` 主导航 active → `bg-accent-bg text-accent-dark`；
      `.app-segmented-button-active` → 绿色浅底 + 绿字
- [x] 深色 token 顺带修层次（卡片 `#171A23` 抬离页面 `#0B0D12`，边框 `#212836`；卡页亮度差 0.003→0.006）
- [x] 验证：浅色全部采样点达到 WCAG AA（最低 4.92；描述 5.77→6.9、作者/用量 4.90→5.42、
      筛选条次级按钮 4.81→6.10）；`tsc` / `eslint` / `npm run build` / `test:ui` 6/6 ✓
- [x] 证据：`output/ui-contrast/evidence/{real-before,real-final}/`
- [ ] 未提交 Git（同前：`electron/main.mjs`、`package.json` 混着用户自己的打包 WIP）

### ✅ 修复：页面加载慢——先逐页逐命令量，再改（2026-10-12 第二轮）

**背景**：上一轮修的是「窗口出来之前」，用户澄清「加载」指的是**应用内某个页面**慢。
于是先做了三件事：① 逐页画像（真实操作路径：整页载入工作台 → `pushState`+`popstate` 切路由）；
② 逐命令计时（隔离夹具：库 DB 副本 + junction 挂载真实 Agent 目录）；③ 分段微基准。

实测（`output/page-perf/`）：

| 位置 | 改动前 | 改动后 |
| --- | --- | --- |
| `get_global_local_skills(claude_code)`（全局工作区页） | **5169ms** | 664ms（再进 444ms） |
| `get_global_local_skills(workbuddy)` | 2294ms | 477ms（再进 260ms） |
| `get_global_local_skills(codex)` | 1721ms | 1294ms（再进 282ms） |
| `check_all_skill_updates`（启动后 3s 自动跑的那轮） | **13390ms** | 29ms |
| 单个 local 技能 `check_skill_update` | 41ms | 4–8ms |
| `check_all_skill_updates` 里 52 个 local 技能合计 | ~2100ms | 243ms |
| `withCenterState`（工作区匹配与同步判定） | 1102ms | 158ms |

- [x] `store.skill(id)`：原来是「重建整张技能表再 find」，逐技能循环里退化成 O(N²)（每次重读 53 个
      SKILL.md + 上百条查询）。改成按 id 单行查询，同一语义、O(1)。
- [x] `check_all_skill_updates` 尊重前端一直在传的 `force`：非强制（启动自动轮次）10 分钟内查过就跳过；
      **上次失败的技能退避 60 分钟**（坏掉的远程每次都要重试 11–30s 的 clone，注定失败）。
      手动「检查全部更新」传 `force=true`，语义不变，随时可强制重试。
- [x] 全局工作区读取（`workspace.mjs`）：
      · 新增 `cachedDirectoryHash()`：用「文件数+总字节+mtime 最大/和」做前置指纹，指纹没变直接复用
        上次的内容哈希（stat 一遍约 85ms，是整目录重读 620ms 的 1/7）。写入类操作不走过缓存。
      · `withCenterState` 的 `liveHashes` 改为按 **canonical 物理目录** 缓存，并预先塞进
        `readSkillsRoot` 已算好的工作区指纹 —— symlink/junction 部署时副本与中心是同一物理目录，
        原来等于把同一个目录整读两遍。
      · `matchCenterSkill` 的 `canonical()`（realpathSync）按请求缓存：53 个已纳管 × 23 个工作区
        技能会形成上千次系统调用，实测贡献数百毫秒。
- [x] 前端：`skill-activity-changed` 的刷新节流到 1.2s（调用记录页与技能库页各一处）。
      扫描期间后端约 250ms 推一次进度，原来每次都整页重查（记录列表 + 来源 / 调用统计），页面持续发烫；
      调用记录页另有 5s 兜底定时，保证扫描结束后一定收敛。
- [x] 验证：`node --check` ×3 / `tsc --noEmit` / `eslint .` / `npm run build` / `test:ui` 6/6 ✓
- [x] 后端测试 **46/50**，与改动前完全相同的 4 项既有失败（2 项环境 git EBUSY、2 项引用用户已删除的
      Preset「应用」链路）；本次改动的 `workspace.test.mjs`、`store.test.mjs` 全部通过 ✓
- [x] 无头实测（`output/page-perf/probe-contention.mjs`，用 `git show HEAD` 导出的旧后端做对照）：
      自动检查进行中打开页面 331ms ／ 安静状态 191ms —— 说明「检查更新」**不会**卡住页面渲染，
      它不是页面慢的主因，真凶是工作区读取（已修）。
- [ ] 未提交 Git（`electron/main.mjs`、`package.json` 里带着用户自己的打包 WIP；本轮改的 `backend/*`、
      `src/views/*` 可以单独提交，待用户确认）

**仍然慢、但属于用户数据自身问题（未改）**：

- 技能详情的「来源差异」页签：库里有 1 个 git 来源已失效的技能，打开该页签要去 clone 远程，
  实测 **11.4s** 才报错；另有一个 112MB 的大技能第一次也要 495ms。前者建议重新关联来源或删掉该技能。

### ✅ 修复：启动「加载很久」——先量后改（2026-10-12）

**背景**：用户反馈打开应用要等很久。先量了整条链路，再动手，结论是「应用内不慢，慢在看得见之前」。

实测（隔离副本 + 真实数据，`output/startup-perf/`）：

| 阶段 | 耗时 |
| --- | --- |
| `npm` 自身冷启动（`npm run app` 的间接层） | **2.6–2.8s** |
| 后端进程 spawn → `/api/health` 就绪 | 515ms |
| 启动四件套（presets/tools/skills/projects 并发） | 47ms |
| 首屏数据落地（`refresh_app_data`） | 110–360ms |

问题不在数据层，而在**等待期间没有任何反馈**：`electron/main.mjs` 原本要等 `/api/health` 才建窗口，
在此之前是「双击了但屏幕上什么都没有」；窗口建出来后 `index.html` 的 `#root` 又是空的，React 挂载前是白屏。

- [x] `start.bat`：直连 `node_modules\.bin\electron.cmd`，绕开 npm 的 ~2.6s 冷启动（保留 npm 回退）
- [x] `electron/main.mjs`：`whenReady` 里先建窗口并载入本地占位页，服务就绪后再换应用页面；
      健康探测首 2 秒加密到 50ms（总超时仍 20s）；服务重启期间回到占位页而不是 reload 一个连不上的页面；
      `ready-to-show` + 3s 兜底 `show()`，避免「双击没反应」
- [x] 新增 `electron/splash.html`（跟随 `localStorage.theme`，非法值按 dark）
- [x] `index.html`：内联首屏占位 + 主题脚本；`src/lib/bootSplash.ts` 负责淡出移除；
      `AppContext` 首次数据落地后（成功或失败）才移除，避免先露出 0 值空壳
      ⚠️ 占位样式必须写在 `#boot-splash` 上：`index.css` 的 `body { bg-background text-primary }`
      源码顺序更靠后，同优先级会盖掉内联的 body 规则（深色下标题曾变成深字黑底）
- [x] `package.json`：`build.files` 排除 `node_modules/**` —— 主进程只用 electron + node 内置，
      运行时依赖由 extraResources 提供，asar **47.7MB → 1.47MB**、解包目录 **434MB → 374MB**
- [x] 验证：`node --check` ×1 / `tsc --noEmit` / `eslint .` / `npm run build` / `test:ui` 6/6 ✓
- [x] 无头实测（`output/startup-perf/verify-splash.mjs`，5 段断言全绿）：拦住 JS 包时占位可见且深/浅色各自正确；
      放行 JS 后占位在 **360ms** 被移除、应用渲染出「工作台」、控制台 0 报错；`electron/splash.html` 本体可渲染
- [x] 打包产物自检（`verify-package.mjs`）：用随包 exe 以 `ELECTRON_RUN_AS_NODE` 跑起 backend，
      53 个技能 / 46 个 Agent 正常返回，随包 dist 与占位页均在
- [ ] **未提交 Git**：本次改动的 `electron/main.mjs`、`package.json` 里同时带着用户自己的打包 WIP，
      按「不捆绑用户 WIP」的约定没有提交，待用户确认

### ✅ 小功能：按效果图重构 Dashboard 与调用记录（2026-10-12）

**背景**：`assets/Dashboard.png` 与 `assets/DiaoYong.png`（源自 `output/dashboard-concept-v1/`、
`output/activity-concept-v1/`）是已交付的设计效果图，本轮把两个页面按图落地。图中数字为示意值，
实现一律用真实数据；文档明确「未实现交互」「窄窗口待验收」的部分由本轮补齐。

**Dashboard（参考 Dashboard.png）**

- [x] 页头：面包屑「总览 / Dashboard」+ 标题「工作台」+ 汇总行；「扫描导入 / 安装 Skills」收拢到右侧
- [x] 三项统计卡：技能总量（查看技能库 →）、部署覆盖（X / Y + 进度条 + 百分比 + N 项未部署）、
      已启用 Agent（数量 + Agent 图标行 + 查看工作区 →）
- [x] 双栏：左侧近期动态（标题 + 全部/技能调用/技能更新 页签 + 查看全部 →）＋右侧 Agent 部署
      （逐 Agent 已部署数 + 管理工作区 →）与同步提醒（复用 `sync_health.diverged`，只给查看入口）
- [x] 「让你的 Agent 管理 Skills」由整块卡片收成矮引导条（左绿线 + 去启用 + 关闭），
      显示条件与选择流程沿用原实现
- [x] 去掉了原「问候语 + 两步操作按钮行」的旧结构；`dashboard.*` 文案按效果图口径改写

**调用记录（参考 DiaoYong.png）**

- [x] 统计四项改为 全部记录 / 明确调用 / 已确认加载 / 仅请求·待确认，紧邻口径说明
- [x] 筛选：搜索 + 工具 + 触发方式 + 记录类型 + **结果（新增）** 常驻；「更多筛选」承载项目与开始/结束日期
- [x] 新增 `status` 查询条件（`backend/activity/store.mjs` 校验表 + `ActivityQuery.status`），
      结果筛选走真实后端过滤
- [x] 列表：五列对齐（技能/项目 · Agent · 类型/触发 · 结果 · 时间）+ 类型页签与触发统计 + 分页；
      窄窗口收敛为两列
- [x] 详情：行内展开改为右侧详情栏（识别依据 / 记录信息 / 来源文件 + 在文件夹中显示 + 打开技能详情），
      选中行浅绿底 + 左侧绿线；详情面板抽成 `ActivityDetailPanel`，技能详情页签内嵌仍复用原列表
- [x] 来源摘要压成一行（N 个来源已启用 + 异常数 + 管理来源），来源编辑与「扫描中不可改」等保护不变
- [x] 窄窗口下选中记录会把详情滚进视野（宽屏两栏并排不打扰）

**验证**

- [x] `npm run build`（含 tsc）✓ / `npm run lint` ✓ / `npm run test:ui` 6/6 ✓
- [x] 后端测试 46/50：4 个失败均为**改动前已存在**（2 个 git EBUSY 环境问题、2 个引用用户已删除的
      Preset「应用」链路），已用 `git stash` 对比确认与本次无关
- [x] 无头 CDP 实测（`output/dash-activity-rework/`，隔离 fixture + 真实部署 + 68 条记录）：
      部署覆盖 5/7 与 71.4%、同步提醒 1 项差异、0 项未部署计数、统计 68=23+23+22、
      失败筛选 11 条、分页 1/2→2/2 且第二页 18 条、选中联动、长路径 0 溢出、
      960px 窄窗口堆叠且 0 横向溢出；浅色/深色/窄窗口截图见 `evidence/after/`
- [x] 提交 Git（两个页面共用一套 i18n 文案与验证脚本，合并为一次提交）

### ✅ 小功能：README 重写为中文主文档（2026-10-12）

**背景**：`README.md` 一直是上游 `xingkongliang` 的英文原文（最后改动 2026-10-08），与本分支实际状态
已经脱节：桌面外壳是 Electron、`src-tauri/` 为空、没有随包的 cargo CLI、上游 CI 工作流对本仓不成立。
用户要求重写为符合自己行文风格的文档（结论先行、结构化、去营销腔、写明边界）。

- [x] `README.md` 重写为中文主文档，166 行（原 285 行）：这是什么 / 现状与边界 / 核心能力（分节）/
      技术栈 / 架构 / 本地开发 / 目录结构 / 许可与来源
- [x] 事实逐条按当前代码核验：54 个内置 Agent（48 coding + 6 lobster，`backend/agents.json`）、
      `v1.40.3`、三语言、`POST /api/invoke/<command>` + SSE `/api/events` + 缺 `x-skills-manager-client` 头即 403、
      备份排除 >100 MB 技能、调用记录 6 来源与「仅请求不计入实际使用」口径（术语取自 `i18n/zh.json`）
- [x] 新增「现状与边界」表：平台与构建方式、Electron 外壳规模、Tauri/cargo 链路不成立、
      托盘/应用内更新/代理在 Electron 外壳未实现、上游 CI 失效、CLI 缺失、测试规模
- [x] 去掉只对上游成立的区块（官网、Homebrew、Release 下载、视频、Trendshift、skills.sh 徽章、
      Buy me a coffee、X），保留 MIT 与一句来源署名（署名 `BJTU-Yibo`）
- [x] 删除 `README.zh-CN.md`（避免两份口径不一致；已确认仓库内无其他引用，仅 `output/ppt-skill/` 的
      大纲把它列为源材料，属历史产物）
- [x] 校验：引用图片 9 个全部存在、代码围栏配对、章节锚点（`#本地开发`）可解析
- [x] 提交 Git

### ✅ 小功能：浅色主题重建卡片与页面层次（2026-10-12）

**背景**：用户反馈技能库「灰蒙蒙」。无头 CDP 实测（`output/ui-contrast/probe.mjs`，逐层 alpha 合成后算 WCAG）
定位两处硬伤：①卡片三层分隔全部失效——卡片 #FFF vs 页面 #FAFAFA 亮度差仅 **0.044**、边框对页面 **1.22:1**、
阴影 4% 透明等于没有；②卡片 12px 次级文字 **#8B8B94 只有 3.38:1**（低于 AA 4.5）。

- [x] `src/index.css` 浅色 token：页面底 `#FAFAFA→#F1F1F4`、侧栏 `#F4F4F5→#F7F7F9`、
      hover `#F4F4F5→#EAEAEE`、active `#E4E4E7→#E0E0E5`、border `#D4D4D8→#C7C7CE`、
      border-subtle `#E4E4E7→#D5D5DB`、border-faint `#EEEEF0→#E7E7EB`、
      muted `#71717A→#65656E`、faint `#8B8B94→#70707A`、阴影加两层
- [x] 验证（同基准 fixture before/after，`output/ui-contrast/evidence/`）：
      卡页亮度差 0.044 → **0.119**；边框对页面 1.22 → **1.30**；作者行/用量行 3.38 ✗ → **4.90 ✓**；
      描述 4.83 → 5.77；筛选条次级按钮 4.40 ✗ → **4.81 ✓**；全部断言转绿
- [x] 回归：设置页 / 调用记录页 / 深色主题各截一张，无副作用
      （设置页「中央仓库路径」标签在**超长路径**下被挤成竖排——已确认改前同样存在，属既有隐患，不在本次范围）
- [x] 提交 Git

### ✅ 小功能：侧边栏 Preset 段按需显示 + 新建入口移到技能库（2026-10-12）

**背景**：用户问「侧边栏 Preset 还有用吗」。核查结论：**不是死代码**（181 处引用，`PresetBar` 在
全局工作区/项目详情是主入口，`viewedPreset` 驱动技能库过滤/排序/拖拽），但用户只有 1 个 Preset
（Default，内含 1 个技能），侧边栏那一段只切换视图过滤、是纯噪音。

- [x] `Sidebar.tsx`：Preset 段改为 `orderedPresets.length > 1` 才渲染（不删功能，只按需显示）；
      移除段内的「+ 新建 Preset」按钮与 `CreatePresetDialog`
- [x] `MySkills.tsx`：筛选条新增「+ 新建 Preset」入口（复用 `app-toolbar-button-secondary`），
      接入创建流程并 refresh
- [x] i18n：`mySkills.newPreset`（中/英/繁）三处补齐
- [x] 验证：侧栏 Preset 标题/Default 行/新建入口 在单 Preset 下均**消失**，筛选条出现新按钮；
      端到端跑通「点按钮 → 填名 → 创建 → 侧栏重新出现 Preset 段（Default + Verification）」
- [x] 提交 Git

### ✅ 小功能：英文展示字体切换为 Segoe UI / Cascadia Code（2026-10-12）

**背景**：用户反馈应用内英文展示（技能名、英文技能文档、来源路径、代码）字体难看。
CDP 实测（`CSS.getPlatformFontsForNode`）定位：原 sans 栈首位 `"SF Pro Text"` 在 Windows 不存在，
英文一路穿透落到 **Noto Sans SC** 的拉丁字形；原 mono 栈末位 generic `monospace` 在中文 Windows 上
解析为 **NSimSun（新宋体）**，`font-mono` 类文本（路径、代码块语言标签）发虚。

- [x] `tailwind.config.js`：sans 栈 `"Segoe UI"` 优先（Windows 原生 UI 字体；macOS 经
      `system-ui` 自动映射 SF；中文经字体链接回落 Microsoft YaHei UI）；mono 栈显式列出
      `"Cascadia Code" / "Cascadia Mono" / Consolas`，末位才交 generic monospace
- [x] `src/index.css`：行内代码、代码块两处等宽声明对齐同一栈（原 `ui-monospace` 起头保留在末位）
- [x] 验证：`npm run build`（含 tsc）✓ / `npm run lint` ✓ / 无头 CDP 同基准 fixture 前后对比——
      正文 Noto Sans SC → **Segoe UI**、font-mono NSimSun → **Cascadia Code**、行内代码 Consolas → Cascadia Code，
      浅色/深色截图与 report.json 见 `output/font-verify/evidence/`
- [x] 提交 Git

### ✅ 小功能：清理 Preset「应用 / 活动」死代码（2026-10-12）

**背景**：v1.16+ 起点击侧边栏 Preset 不再触发应用（`tauri.ts` 曾标 `@deprecated`），
导致 `activePreset`、`applyPresetToDefault`、后端 `apply_preset_to_default` / `switch_preset`
全部失去调用点。技能库页删掉单技能开关后，这条链路更无用途。

- [x] 前端：删除 `activePreset` state / 接口字段 / value 导出；`viewedPreset` resolve 去掉该依赖
- [x] 前端：删除 `handleApplyPresetToDefault` 及其接口与 value 导出；`refreshPresets` 不再拉 `getActivePreset`
      （连带删掉 `lastActivePresetIdRef` 与那段「跟随外部切换」的逻辑）
- [x] 前端：`tauri.ts` 删除 `getActivePreset` / `switchPreset` / `applyPresetToDefault`
- [x] 后端：`presets.mjs` 删除 `switch_preset` / `apply_preset_to_default` 命令与 `applyPreset` 函数
      （`presetCommands` 签名从 `(store, library)` 收敛为 `(store)`）
- [x] 后端：`store.mjs` 删除失去调用点的 `setActiveScenario`
- [x] 后端：`server.mjs` 删除 `get_active_preset` 命令
- [x] **保留** `activeScenarioId()` 及其在 `sync_skill_to_tool` / `unsync_skill_from_tool` /
      `set_skill_tool_toggle` 里的分支 —— 它们读 `active_scenario` 表，删除会改变同步行为，另行评估
- [x] 验证：`node --check` ×3 ✓ / `npx tsc --noEmit` ✓ / `npx eslint` ✓ / `npm run build` ✓
      / 无头截图确认侧边栏 Preset（Default 高亮）、筛选条、分类标签、列表列对齐均正常
- [x] 提交 Git

### ✅ 小功能：删除技能库的「Preset 单技能开关」（2026-10-12）

**背景**：用户在列表视图看到最右侧的启用开关，确认不需要这个入口（语义是把技能加入/移出当前 Preset）。
**保留**：多选后的批量启停入口（`handleBatchTogglePreset`）、行首状态点。

- [x] 列表视图：删除 `ToggleSwitch`；操作列宽 `w-[72px]` → `w-[32px]`
- [x] 网格视图：删除卡片底部的 `ToggleSwitch`
- [x] 删除不再使用的 `handleTogglePreset` 函数与 `ToggleSwitch` 导入
- [x] 验证：`npx tsc --noEmit` ✓ / `npx eslint` ✓ / `npm run build` ✓
      / 无头截图确认两个视图 `role="switch"` 数量均为 **0**，列表列仍完全对齐
- [x] 提交 Git

### ✅ 小功能：调用记录新增 WorkBuddy AI 来源（2026-10-12）

**背景**：WorkBuddy 与 WorkBuddy AI 是两个独立产品，日志分别在 `~/.workbuddy` 与 `~/.workbuddy-ai`，
原先只采集前者。

- [x] `backend/activity/store.mjs`：`TOOLS` 加 `workbuddy_ai`；`defaultSources()` 加路径
- [x] `backend/activity/scanner.mjs`：`parsers` 复用 `parseWorkbuddy`
- [x] `src/lib/activity.ts`：`activityTools` / `toolNames` / `toolIconKeys`
- [x] 验证：隔离环境放入真实日志样本 → 来源数 5→6，解析出 Skill 调用记录
- [x] 真实配置已登记（`sources` 表出现 `workbuddy_ai`）

### ✅ 小功能：修复技能库列表视图列不对齐（2026-10-12）

**背景**：列表视图除描述列外，作者/标签/状态组都是内容自适应宽度，导致每行列位置漂移。

- [x] 除描述列外全部固定宽度；「缺失来源」改为固定槽位
- [x] 验证：6 行各列起始 x 坐标完全一致
- [x] 提交 Git

---

## 待办池（用户已提出、尚未开始）

- 用 `codex-ppt` 技能生成 skills-manager 的项目介绍 PPT —— 停在「2 张样张已确认」阶段，
  下一步是生成剩余 8 页 → QA → 写讲稿 → 组装 `.pptx`。
