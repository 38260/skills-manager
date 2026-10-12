# Agent 工作 Todo

> 工作约定：每个「小功能」独立完成 → 跑静态检查（`npx tsc --noEmit` + `npm run build`）→ **提交一次 Git** → 回到这里勾选。
> 提交时只带该小功能相关文件，不捆绑用户自己的 WIP。

---

## 进行中

（暂无）

---

## 已完成

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
