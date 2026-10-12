<p align="center">
  <img src="assets/icon.png" width="72" />
</p>

<h1 align="center">Skills Manager</h1>

<p align="center">
  本地优先的 Agent Skills 管理器：中央库一处存放，按 Preset 分组，部署给任意编码 Agent。
</p>

<p align="center">
  <img src="assets/screenshots/library.png" width="860" alt="技能库：中央库、分类过滤与逐技能部署状态" />
</p>

## 这是什么

Agent Skills 本身只是文件，但「装在哪几个 Agent、是不是最新、谁在用」散落在各家目录约定里。这个应用把这件事收拢到一处：

- 技能收进一个中央库（默认 `~/.skills-manager`）。来源可以是本地目录、Git 仓库、`.zip` / `.skill` 包，或 [skills.sh](https://skills.sh) 市场。
- 需要时部署给 **54 个内置 Agent**（48 个编码 Agent + 6 个龙虾 Agent，清单见 `backend/agents.json`），方式为软链接（junction）或文件复制。
- 来源元数据、Preset 归属、更新状态、调用记录都留在库里，不依赖任何单个 Agent 的目录规范。

> 本仓是上游 [xingkongliang/skills-manager](https://github.com/xingkongliang/skills-manager) 的**本地开发分支**，不是官方发行版。桌面外壳为 Electron，当前只在 Windows 上构建。

## 界面

以下截图使用**虚构的演示数据**（9 个示例技能、5 个 Agent、2 个项目、68 条调用记录），浅色主题，
未做任何后期处理。演示数据由 [`output/readme-shots/seed-demo.mjs`](output/readme-shots/seed-demo.mjs)
生成在隔离目录 `D:/sm-demo`，不涉及任何真实技能库与日志。

<p align="center">
  <img src="assets/screenshots/dashboard.png" width="820" alt="工作台" />
</p>
<p align="center"><strong>工作台</strong> — 技能总量、部署覆盖率、已启用 Agent，以及近期动态（技能调用与技能更新合并成一条时间流）</p>

<p align="center">
  <img src="assets/screenshots/activity.png" width="820" alt="调用记录" />
</p>
<p align="center"><strong>调用记录</strong> — 六类来源、统计口径、筛选与分页；右侧是选中记录的识别依据与来源定位</p>

<p align="center">
  <img src="assets/screenshots/skill-detail.png" width="820" alt="技能详情" />
</p>
<p align="center"><strong>技能详情</strong> — 渲染 <code>SKILL.md</code>，右栏是目录、项目结构、来源信息与部署到工具</p>

<p align="center">
  <img src="assets/screenshots/workspace.png" width="820" alt="全局工作区" />
</p>
<p align="center"><strong>全局工作区</strong> — 每个 Agent 一页，列出它全局目录里实际能看到的技能（含不是本应用装的）</p>

<p align="center">
  <img src="assets/screenshots/install.png" width="820" alt="安装 Skills" />
</p>
<p align="center"><strong>安装 Skills</strong> — 浏览 skills.sh 市场、本地目录安装、Git 仓库安装</p>

<p align="center">
  <img src="assets/screenshots/backup.png" width="820" alt="备份与多设备同步" />
</p>
<p align="center"><strong>备份与多设备同步</strong> — 技能库托管为 Git 仓库，单机可回滚快照，多机连同一仓库自动对齐</p>

<p align="center">
  <img src="assets/screenshots/settings.png" width="820" alt="设置" />
</p>
<p align="center"><strong>设置</strong> — 仓库路径、同步模式、主题、字号、界面语言、Git 远程</p>

## 现状与边界

先把状态说清楚，避免误期待。

| 项 | 现状 |
| --- | --- |
| 版本 | `1.40.3`（见 `package.json`） |
| 平台 | Windows，自行构建：`npm run dist` → 绿色便携版 `SkillsManager-Portable.exe`。本分支不发布 Release 安装包 |
| 桌面外壳 | Electron 44：起本地服务 → 先显示本地启动占位页 → 等 `/api/health` 就绪 → 载入应用；服务退出（含应用内重启）自动拉起。`electron/main.mjs` 155 行 + `preload.cjs` 10 行 / 4 项受控能力 |
| 打包产物 | `app.asar` 只装 `dist/` + `electron/` + `package.json`（约 1.5 MB）；后端运行时依赖 `fflate` / `js-yaml` / `argparse` 走 `extraResources`，不重复打进 asar |
| Tauri | 三环境适配层保留，但 `src-tauri/` 为空，Rust / `cargo` 链路在本分支不成立 |
| 上游遗留 | 设置页仍有「托盘」「应用内更新」「代理透传」等 Tauri 时期入口，Electron 外壳**未实现**对应链路，不要当成可用功能 |
| CI | `.github/workflows/` 仍是上游的 Rust / Tauri 工作流，对本分支无意义；真正有效的是 `frontend.yml`（Node 22，lint + build） |
| CLI | 上游随包提供的 `skills-manager-cli` 不在本分支内，`scripts/run-rust-cli.mjs` 是残留脚本 |
| 测试 | 后端 19 个测试文件、Electron 1 个、前端 3 个；命令见[本地开发](#本地开发)。视觉类改动以无头实测 + 截图留证 |
| 已知慢点 | 技能详情的「来源与差异」页签需要拉取远端内容：来源是 Git 仓库时会 clone，远程不可达时最长可等到十秒级；本地来源则只读目录 |

## 核心能力

### 技能库

- **来源**：本地目录、Git 仓库、`.zip` / `.skill` 包、skills.sh 市场。
- **视图**：网格 / 列表；列表除描述列外全部固定列宽，逐行对齐。
- **卡片信息**：状态点、别名、说明、作者、分类标签、调用统计（次数 + 最近使用）、来源徽标、各 Agent 同步角标。
- **筛选**：搜索（含别名）、来源、分类、「全部 / 当前 Preset 已启用 / 当前 Preset 未启用」单选、未标注项。
- **批量**：多选后批量启用停用、批量打分类、导出、删除。
- **编辑**：别名、说明、作者可在应用内覆盖，不改动 `SKILL.md` 源文件。
- **自定义工具**：可添加自有 Agent 并指定技能目录，也可覆盖内置 Agent 的默认路径。

### 让你的 Agent 管理 Skills

工作台上有一个一次性入口：勾选哪些 Agent 可以这么做，应用就把 [`manage-skills`](skills/manage-skills/SKILL.md) 装进技能库，并只部署给你勾选的那些 Agent。之后它就是一个普通的库内技能——增减 Agent 用它自己卡片上的角标行。

默认不预勾选任何 Agent：一键铺满所有已安装 Agent 等于全量部署，而这个应用本身就是用来管好「哪些 Agent 该看到哪些技能」的。

### Preset

- 作用是把技能分组，让同一套技能能按场景切换。
- 当前语义：Preset 是**分组 + 视图过滤 + 逐 Agent 部署开关**的载体。点击侧边栏 Preset 只切换技能库的过滤与排序，不再「应用」任何东西——原先的一键应用链路已删除。
- 显示规则：只有存在 **2 个及以上** Preset 时侧边栏才显示该段；新建入口在技能库筛选条。

### 工作区

- **全局工作区**：每个 Agent 一页，列出它全局目录里的全部技能（包含不是本应用装的），反映 Agent 实际看到的内容；「全部 Agents」可跨已安装 Agent 统一管理。
- **龙虾 Agent**：同一套模型，承载另一类 Agent。
- **项目工作区**：管理任意项目内的技能目录，可与中央库双向同步，支持按 Agent 导出。
- **关联工作区**：把任意目录指定为技能根目录，不参与全局 Preset 同步。

```mermaid
flowchart LR
  L["中央库<br/>~/.skills-manager"] -->|"Preset：分组 · 过滤 · 逐 Agent 开关"| G["全局工作区<br/>各 Agent 的全局技能目录"]
  L -->|"双向同步"| P["项目工作区<br/>项目内的技能目录"]
  L -->|"软链接 / 复制"| D["部署产物"]
  G --> A["Agent"]
  P --> A
  D --> A
```

### 技能详情

- 渲染 `SKILL.md`：标题锚点目录、代码块复制、表格与引用样式，兼容 Windows 换行与 BOM。
- 右栏平面分组：目录、项目结构（默认收拢）、来源信息与来源差异、部署到工具（默认折叠，只列已安装 Agent）。
- 调用记录在页签内嵌入展示，不跳页。
- 页头在正文下滑后收成紧凑形态。

### 调用记录

- **6 个来源**：Codex、DeepSeek Harness、ZCode、Qoder、WorkBuddy、WorkBuddy AI，每个来源可单独启停。
- **记录类型**：明确调用 / 已确认加载 / 仅请求（待确认）。
- **触发方式**：手动触发 / 自动触发 / 来源未知；**结果**：等待结果 / 已返回 / 失败 / 结果未知（「已返回」只表示工具返回了结果，不代表整个任务成功）。
- **统计口径**：仅请求不计入实际使用，数量只统计明确调用与已确认加载；缺少明确触发证据时显示「来源未知」，不猜。
- 详情侧栏给出识别依据、来源文件、行号／记录位置、会话 ID 与调用 ID，可直接在文件夹中显示；记录读不到时保留原始记录，不静默丢弃。

### 备份与多设备同步

- 技能库托管在一个 Git 仓库：单机是带历史、可回滚快照的备份；多机连同一仓库自动保持一致。
- GitHub 登录一键创建私有仓库；远端始终是纯 Git 仓库，随时可以 `git clone` 走。
- 冲突以技能为单位，不覆盖、不阻塞：本机版本保留，由你三选一处理（保留本机 / 用远端 / 两者都留），每次选择前自动存快照。
- 技能、标签、Preset 与逐 Agent 开关进备份；密钥和机器相关配置不离开本机；超过 100 MB 的技能留在本地并自动排除。

### 设置

仓库路径、同步模式（符号链接 / 文件复制）、主题（浅色 / 深色 / 跟随系统）、字号、界面语言（简体中文 / English / 繁體中文）、Git 远程、导出日志。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | React 19 + Vite 7 + TypeScript 5.9 + Tailwind 3.4 + i18next |
| 桌面 | Electron 44：主进程负责起服务、健康检查、窗口与外链守卫 |
| 后端 | Node 22 内置 `http` + `node:sqlite`，无外部运行时依赖，随应用分发 |
| 打包 | electron-builder，Windows `portable` 目标 |

## 架构

- 前端与本地服务之间只有一种调用形状：`POST /api/invoke/<command>`，事件走 SSE `/api/events`。请求必须带 `x-skills-manager-client` 头，缺失直接 403——避免普通网页误连本地服务。
- 三环境统一：Tauri（原生 IPC）、Electron 与纯浏览器（本地 HTTP）、导入导出（不依赖任一宿主），业务代码无感知。见 `src/lib/transport.ts` 与 `src/lib/desktop.ts`。
- 数据分三层：SQLite（`~/.skills-manager/skills-manager.db`）、中央库文件、部署产物（软链接或复制到各 Agent 目录）。

```mermaid
flowchart LR
  UI["前端 React"] -->|"POST /api/invoke/命令"| S["本地服务<br/>Node 22 · 仅监听回环"]
  S --> DB[("SQLite<br/>技能 · Preset · 设置")]
  S --> FILES["中央库文件<br/>~/.skills-manager/skills"]
  S --> ACT[("调用记录库<br/>独立 SQLite")]
  S --> DEPLOY["各 Agent 目录<br/>软链接 / 复制"]
  S -.->|"SSE /api/events"| UI
  ACT -.->|"后台扫描<br/>独立线程"| L["各客户端日志"]
```

## 本地开发

前置：Node **22 及以上**、Windows。不需要 Rust。

| 命令 | 作用 |
| --- | --- |
| `npm install` | 安装依赖 |
| `npm run dev` | 前端开发服务器（Vite，同时拉起本地服务） |
| `npm run start` | 只起后端本地服务 |
| `npm run app` | 以 Electron 启动桌面应用 |
| `npm run build` | `tsc -b` + `vite build`，产物在 `dist/` |
| `npm run lint` | ESLint |
| `node --test tests/backend/*.test.mjs` | 后端测试 |
| `npm run test:ui` | 前端测试 |
| `npm run dist` | 打包便携版到 `release/` |

## 目录结构

```
backend/    本地服务：store / library / presets / tools / scan / workspace / projects / backup / activity
electron/   桌面外壳：main.mjs（155 行）+ splash.html（启动占位页）+ preload.cjs（4 项受控能力）
src/        前端：views / components / lib / i18n / context
tests/      backend / electron / ui
output/     验收与探针产物（隔离数据不入库）
assets/     图标、截图、概念图
```

## 许可与来源

MIT，见 [`LICENSE`](LICENSE)。

上游：[xingkongliang/skills-manager](https://github.com/xingkongliang/skills-manager)。本分支（`38260/skills-manager`）的改造与维护：**BJTU-Yibo**。
