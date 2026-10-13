# Agent 工作 Todo

> 工作约定：每个「小功能」独立完成 → 跑静态检查（`npx tsc --noEmit` + `npm run build`）→ **提交一次 Git** → 回到这里勾选。
> 提交时只带该小功能相关文件，不捆绑用户自己的 WIP。

---

## 进行中

### 第六轮：UI / 交互细节修复（2026-10-13）

> 起因：一次界面细节走查给出 7 条问题（反馈是否准确、失败后能否恢复、操作是否一致）。
> 拆成 7 个可独立提交的小功能；每完成一个 → `npx tsc -b` + `npm run build` → 提交一次 Git → 回来勾选。
> 提交只带该小功能相关文件，不捆绑工作区里已有的 WIP（`backend/*`、`MySkills.tsx`、`index.css`、
> `AppContext.tsx`、`Sidebar.tsx`、`main.tsx`、`index.html`、`package*.json`、`ACCEPTANCE.md`、
> `TODO.md`、`tests/backend/*` 与 splash 相关未跟踪文件）。

| # | 小功能 | 问题 | 状态 |
| --- | --- | --- | --- |
| F1 | 确认框执行中锁住关闭入口 | 执行中点「取消」只关窗、任务继续，用户以为已取消 | [x] |
| F2 | 调用记录详情跟随最新数据 | 刷新后右栏保留旧对象，状态/触发方式/识别依据可能与列表不一致 | [x] |
| F3 | 来源读取失败可重试 | 读取失败后切页签不重试、无重试入口、也看不到原因 | [x] |
| F4 | 列表加载改为首屏骨架 + 原地进度 | 刷新时整列消失、筛选时旧结果无任何「正在查询」提示 | [x] |
| F5 | 工作区卡片键盘可达与操作兜底 | 卡片是 `div onClick`，键盘打不开；行内操作只在悬停时显形 | [ ] |
| F6 | DetailSheet 焦点管理与 Esc | 缺 Esc 关闭、焦点管理、关闭按钮无可读名称，Tab 会跑到被遮挡内容上 | [ ] |
| F7 | 详情徽章复用列表配色 | 表格触发徽章分三色，详情里全用绿色，同一状态两处含义不一致 | [ ] |
| F8 | 整体测试与交付验收 | 构建 / lint / 单测 / 无头界面断言 + 截图 | [ ] |

**本轮不做**

| 项 | 原因 |
| --- | --- |
| 给不可中止的后端操作真的加「中止」 | 后端 `upload/pull/delete/batch` 没有取消通道，能做的只是不让用户误以为取消成功；真中止要改任务模型，超出本轮范围 |
| `DetailSheet` 打开时把 `#root` 设为 `inert` | 同页面还会叠 `AddSkillsSheet`／`ConfirmDialog`，它们渲染在 `#root` 内，一旦 inert 就整体失效。改用「焦点圈在弹层内」的键盘拦截达到同样效果 |
| 把技能库（`MySkills.tsx`）的同形卡片一并改造 | 该文件正被用户的 WIP 修改，本轮不碰；F5 的模式（`role=button` + Enter/Space + `focus-within`）可原样复用 |

**改动记录**

| 日期 | 批次 | 内容 | 涉及文件 | 验证 |
| --- | --- | --- | --- | --- |
| 2026-10-13 | F1 | 确认框在执行期一律锁住关闭入口：`lockWhileRunning` 开关删掉（原先默认关，18 个调用点里只有 1 个传了 `true`，其余「取消」按钮点下去只是关窗、后端任务照跑）；执行期取消／X／遮罩点击／Esc 全部失效，确认按钮文案改「执行中...」，底部补 `role="status"` 说明；X 按钮补可读名称 | `src/components/ConfirmDialog.tsx`、`src/hooks/useSetAsideOffer.tsx`、`src/i18n/{zh,en,zh-TW}.json` | `tsc -b` ✓ `eslint` ✓ `vite build` ✓ |
| 2026-10-13 | F2 | 调用记录右栏改为「按 id 保留选中、内容取最新返回的那条」：原先刷新后详情仍拿着旧对象，扫描把 pending 改成 returned 或重新判定触发方式后，右栏与同一行的列表读数不一致 | `src/views/SkillActivity.tsx` | `tsc -b` ✓ `eslint` ✓ `vite build` ✓ |
| 2026-10-13 | F3 | 来源页签读取失败改为「可见 + 可恢复」：显示后端返回的真实原因；**只有成功**才登记版本复用标记（`sourceLoadedVersionRef`），失败不再留标记 → 切走再切回本页签自动重读；两处失败各给「重试」入口（共享 `sourceReloadToken`）。加载中/失败态改由「尝试 key（来源版本#重试次数）」派生，避免在 effect 里同步 setState（`react-hooks/set-state-in-effect` 报 error，仓库其余部分 lint 全绿） | `src/components/SkillDetailPanel.tsx`、`src/i18n/{zh,en,zh-TW}.json` | `tsc -b` ✓ `eslint src/` ✓ `vite build` ✓ |
| 2026-10-13 | F4 | 加载反馈改成「不破坏已有内容」：工作区按 Agent 记录数据归属（`localSkillsAgentKey`），首屏／换 Agent 出 6 张骨架卡，同 Agent 刷新保留列表并在列表上方给「正在刷新列表…」；调用记录再查询时旧结果留在原地，表格上方补「正在更新结果…」（原先 `loading && !result` 让第二次查询完全没有反馈）。两处容器补 `aria-busy`，进度文案 `aria-live="polite"` | `src/views/WorkspaceView.tsx`、`src/views/SkillActivity.tsx`、`src/i18n/{zh,en,zh-TW}.json` | `tsc -b` ✓ `eslint src/` ✓ `vite build` ✓ |

---

### 第五轮：调用记录徽章 / 来源判定 / 市场下载量 / 来源仓库（2026-10-12 晚）

> 用户提出四条需求，拆成四个可独立提交的小功能；每完成一个 → 静态检查 → 提交一次 Git → 回来勾选。

| # | 小功能 | 内容 | 状态 |
| --- | --- | --- | --- |
| A | 记录类型 / 触发方式加色彩底纹 | `lib/activityTone.ts` 抽出三类徽章配色（记录类型 / 触发方式 / 结果），列表与表格接入；补对比度自检 | [x] |
| B | 修「来源未知」 | 起因：解析器只认 `$skill` / `/skill`，未点名即判 `unknown`。改为「有用户消息但未点名 → 自动（Agent 自选）」，并识别 WorkBuddy 的 `@skill:` 写法；`PARSER_VERSION` +1 强制重扫；补 `evidenceCodes.agent_choice` 三语文案 | [x] |
| C | 市场页显示下载量 / 热度 | skills.sh 改版，榜单页已无 `__NEXT_DATA__`，兜底正则也抓不到 `installs`（全为 0）；且 UI 只在「全部」页签显示 | [x] |
| D | 「查看来源」展示 GitHub 仓库 | 技能详情「来源信息」区块补一行上游仓库；安装页市场卡片加 GitHub 入口；逐个核对 53 个技能的内容后写入映射，核不出的留空 | [x] |

**本轮不做**

| 项 | 原因 |
| --- | --- |
| 改动技能库数据库（`~/.skills-manager/skills-manager.db`）里 52 个 local 技能的 `source_ref` | 那是用户数据；把「本地路径」改写成「远程仓库」会让「转为本地副本 / 原路径丢失」等既有链路失真。D 的仓库信息走**只读映射**，不写库 |
| 对 600 条榜单技能逐个请求 GitHub API 验证仓库 | 未认证限流 60 次/小时，600 条必然打满且拖慢首次加载；改为「能推导就展示、推导不到留空」 |

**改动记录**

| 日期 | 批次 | 内容 | 涉及文件 | 验证 |
| --- | --- | --- | --- | --- |
| 2026-10-12 | A | 徽章配色抽成 `activityTone.ts`（此前「记录类型」是无底色灰字、触发色很淡），列表/表格接入 | `src/lib/activityTone.ts`、`src/components/ActivityRecordList.tsx`、`src/components/ActivityTable.tsx` | 对比度自检全绿（详见下） |
| 2026-10-12 | B | 触发判定改为「本轮是否出现过用户消息」，新增 `@skill:` 识别，补 `agent_choice` 文案 | `backend/activity/context.mjs`、`backend/activity/scanner.mjs`、`src/i18n/{zh,en,zh-TW}.json` | 全量重扫对照，unknown 177 → 0 |
| 2026-10-12 | C | 榜单解析改走 RSC 载荷（`initialSkills`），卡片在三个页签都显示下载量，热门榜另显示较昨日增量 | `backend/skillssh.mjs`、`src/views/InstallSkills.tsx`、`src/lib/tauri.ts`、`src/i18n/{zh,en,zh-TW}.json` | 三个榜单实测，installs 由全 0 → 600/600 有值 |
| 2026-10-12 | D | 新增 `lib/skillRepo.ts`：技能来源 → GitHub 仓库（技能自身来源优先，其次逐个核对过的映射）；技能详情「来源信息」与市场卡片接入 | `src/lib/skillRepo.ts`、`src/components/SkillDetailPanel.tsx`、`src/views/InstallSkills.tsx`、`src/i18n/{zh,en,zh-TW}.json` | 53 个技能逐内容核对，确证 14 个、排除 5 个同名不同物 |
| 2026-10-12 | 整体测试 | 触发方式断言按新契约更新，并补「无用户消息仍为来源未知」边界用例 | `tests/backend/activity-{parsers,dsh,qoder,workbuddy}.test.mjs` | 后端 47/51，无新增回归 |
| 2026-10-12 | 整体测试 | 界面级验收脚本；对照脚本改为从固定基线取旧解析器（原先写 HEAD，提交后会基线漂移） | `output/final-check/verify-ui.mjs`、`output/activity-fix/compare-trigger.mjs`、`.gitignore` | 6/6 通过 |

**批次 A 验证**（`output/activity-fix/check-chip-contrast.mjs`；色值不手抄 —— tailwind 内置色取自 `node_modules`，项目 token 取自 `src/index.css`）

徽章文字对「卡片底（`--color-surface`）叠徽章底色」的 WCAG 对比度，9 个徽章 × 2 主题：

| 分组 | 浅色 | 深色 |
| --- | --- | --- |
| 记录类型（明确调用 / 已确认加载 / 仅请求） | 6.99 / 5.00 / 4.65 | 7.84 / 10.07 / 10.23 |
| 触发方式（手动 / 自动 / 来源未知） | 4.94 / 5.37 / 7.87 | 7.79 / 9.04 / 7.11 |
| 结果（已返回 / 等待 / 失败 / 未知） | 4.99 / 4.65 / **5.66** / 7.87 | 9.83 / 10.23 / 8.35 / 7.11 |

全部 ≥ 4.5。**顺带修**：`failed` 徽章原用 `text-red-600`，浅色下只有 **4.23 ✗**，改 `text-red-700` 后 **5.66 ✓**。

**批次 B 验证**（`output/activity-fix/compare-trigger.mjs`：同一批真实日志 + 两份库副本，**从空表**分别用改动前/后的解析器重扫）

| 解析器 | 结果 |
| --- | --- |
| 改动前（`git show HEAD` 版） | **177 条全部 `unknown`**（`skill_call` 114 + `document_read` 63） |
| 改动后（当前） | `automatic` 172（`agent_choice`）+ `manual` 10（`user_selection`），**`unknown` 0 条** |

根因：旧判定是「只有用户写了 `$技能名` / `/skill 技能名` 才算 manual，其余一律 unknown」，
而本机 WorkBuddy 的日志里**一条 `$` / `/skill` 都没匹配到**，于是整页都是「来源未知」。

⚠️ 对照方法上的坑：`events` 表的 UPSERT 是**只升级不降级**（`trigger` 仅在 `excluded='manual'`
或 `events='unknown'` 时才被覆盖），所以拿一份已被新解析器写过的库当起点，旧解析器的 `unknown`
根本写不进去 —— 会得到「新旧一样」的假结论。必须两边都从空表重扫。

**批次 C 验证**（直连后端模块实测 skills.sh 三个榜单 + 搜索接口）

| 榜单 | 修复前 | 修复后 |
| --- | --- | --- |
| 全部 alltime | 600 条，`installs` **全为 0** | 600 条，600 条有值（首条 3,809,344） |
| 热门 hot | 600 条，`installs` **全为 0** | 600 条，600 条有值（首条 511，另有较昨日 +314） |
| 趋势 trending | 600 条，`installs` **全为 0** | 600 条，600 条有值（首条 30,168） |
| 搜索 pdf | 10 条，有值（走 `/api/search`） | 不变 |

根因两条叠加：① 站点从 Pages Router 换成 App Router，`__NEXT_DATA__` 已消失（三个榜单实测
`nextData false`），数据改成分片推在 `self.__next_f.push([1,"…"])` 的 RSC 载荷里，列表在
`"initialSkills"` 字段下；② 兜底正则把 `(?:"installs":(\d+))?` 写在 `[^{}]*?` 之后，**可选组被
引擎直接跳过**，于是 installs 一个都取不到。UI 侧还额外限了「只在全部页签渲染下载量」，
两个原因叠在一起，热门 / 趋势页连位置都没有。

**批次 D 验证**（`output/skill-source/verify-repos.mjs`：对 14 个知名「技能集」仓库各取一次文件树，
用本机 53 个技能名匹配 `<技能名>/SKILL.md`，命中后抓原文与本机 description **前 100 字逐字比对**）

确证 **14 个**（写进 `src/lib/skillRepo.ts` 的 `SKILL_REPOS`）：

| 仓库 | 技能 |
| --- | --- |
| `anthropics/skills` | frontend-design、skill-creator |
| `emilkowalski/skills` | animation-vocabulary、apple-design、emil-design-eng、find-animation-opportunities、improve-animations、review-animations |
| `openai/skills` | figma、pdf、playwright |
| `mattpocock/skills` | grill-me |
| `tt-a1i/archify` | archify |
| `chuspeeism/dashi-ppt-skill` | dashi-ppt |

**「同名但不同物」，明确排除 5 条**（描述完全对不上，直接按名字关联就会指错仓库）：
`pdf` ≠ anthropics/skills、`skill-creator` ≠ openai/skills、`find-skills` ≠ vercel-labs/skills、
`aihot` ≠ kkkkhazix/khazix-skills、`figma` ≠ heygen-com/hyperframes。

其余 **39 个**本地技能（多为自建，如 zyb-ui-design / nature-figure-qa-gate / windows-disk-usage-audit）
查不到可确证的上游仓库，按用户要求**留空**。

市场页的来源串另有站点型（`smithery.ai/apple-design`、`skills.volces.com/find-skills`、
`open.feishu.cn/lark-doc`），`marketRepoUrl()` 按「两段都不得含点」过滤掉，不给打不开的地址。

---

### 整体测试记录（2026-10-12 晚）

| 校验门 | 结果 |
| --- | --- |
| `npx tsc -b` | ✓ |
| `npm run lint` | ✓ |
| `npm run test:ui` | 6/6 ✓ |
| `npm run build` | ✓ |
| 后端 `node --test tests/backend/*.test.mjs` | **47/51**（其中 +1 为本次新增的边界用例） |

后端 4 项失败为**改动前既有**、与本次无关：`two-device sync` / `git-source update regression`
（本沙箱 git EBUSY）、`preset apply` / `设置读写、活动预设持久`（引用用户已删除的 Preset「应用」链路）。

**测试中发现并修的回归**：B 有意收窄了触发判定契约，4 个 activity 解析用例断言的正是旧契约
（「非点名即 unknown」）。已按新契约更新断言（`unknown` → `automatic`）并在代码里注明原因，
而不是删掉断言；同时新增 1 条边界用例，守住 `unknown` 仍只属于「本轮完全没有用户消息」
（归档片段那类日志），避免这次改动把 `unknown` 一并改没。

**界面级验收**（`output/final-check/verify-ui.mjs`：真实库起服务 + 无头 Chrome + CDP 直接读 DOM，**6/6 ✓**）

| # | 断言 | 实测读数 |
| --- | --- | --- |
| A | 记录类型 / 触发方式徽章带底色 | 列表徽章带 `bg-indigo-500/10` / `bg-teal-500/10` / `bg-amber-500/10` ✓ |
| B | 列表不再出现「来源未知」 | 自动触发 **51** · 手动触发 0 · **来源未知 0** |
| C | 市场卡片显示下载量 | 25 个下载量图标；数字 3.8M · 1.3M · 26 · 6 … |
| D | 技能详情「来源信息」显示上游仓库 | 打开 apple-design → 右栏出现 `emilkowalski/skills` |

截图写在 `output/final-check/shots/`（含真实技能名与本机路径，已 gitignore，不入库）。

> 踩坑备忘：`svg.lucide-download-cloud` 这种写死图标类名的断言会永远为红 ——
> lucide 已把 `DownloadCloud` 改名为 `CloudDownload`，生成的类名是 `lucide-cloud-download`。
> 断言改成 `svg[class*="download"]`。

---

### 第七轮：调用记录一页数量与详情位置（2026-10-12 晚）

**背景**：用户反馈「要限制一页数量，点击之后记录详情要放在旁边，而不是还在最上面」。

**先量再改**（`output/activity-layout/inspect.mjs`，四个宽度实测列表与详情的位置关系）：

| 宽度 | 改动前 | 改动后 |
| --- | --- | --- |
| 1440px | 并排（详情 left 1040） | 并排 + 吸顶跟随 |
| 1200px | **单栏**，详情被甩到 top 3777 | 并排（left 800）+ 吸顶 |
| 1100px | **单栏**，详情被甩到 top 3777 | 并排（left 700）+ 吸顶 |
| 960px | 单栏，详情 top 3477 | 单栏，点击后详情落在视口内（top 327） |

根因两条：① 并排断点是 `xl`(1280px)，1200 / 1100 这类常见窗口直接掉进单栏；② 一页 50 条把
列表撑到 3600px，详情被甩到最底下 —— 而点击时的 `scrollIntoView({ block: "start" })` 又把详情
顶到视口最顶部，这就是用户说的「还在最上面」。

- [x] `SkillActivity`：每页 50 → **20**
- [x] `SkillActivity`：并排断点 `xl`(1280) → **`lg`**(1024)
- [x] `ActivityTable`：列断点跟着从 `lg` 提到 `xl` —— **必须一起改**，只改外层会让 1024–1280
      变成「两列网格塞五个单元格」，每条记录折成两行（实测列表面板高 3324px，改后 1305px）
- [x] 详情栏加 `lg:sticky lg:top-4`，长列表滚动时跟随
- [x] 窄屏点击的 `scrollIntoView` 由 `block: "start"` 改为 `"nearest"`，不再把详情顶到最上面

**验证**：`tsc` / `lint` / `test:ui` 6/6 / `build` 全绿；复跑 `output/final-check/verify-ui.mjs`
仍 6/6（调用记录页「来源未知」0 条，一页 20 条 + 详情 1 = 21 个「自动触发」）；
布局读数见上表，截图在 `output/activity-layout/shots/`（已 gitignore）。

---

### 第八轮：调用记录 → 技能详情 → 回来（2026-10-12 晚）

**背景**：用户要求「调用记录加一个转到这个 skill 详情里去，然后还能从 skill 详情里回来」。

**核实后发现三处问题**（都不是"加个按钮"那么简单）：

1. 入口本来就存在（`ActivityDetailPanel` 的「打开技能详情」），但**只在 `managedSkillId`
   严格匹配（技能路径可验证）时才显示** —— 实测 20 条里 **0 条**可用，全走「未关联技能库」
2. 那个按钮点了会 `navigate("/my-skills")`，**把人带去技能库页**，关掉弹层就停在技能库，
   回不到调用记录 —— 这正是「还能回来」要解决的
3. 更根本的：`SkillDetailPanel` 只在 `MySkills.tsx` 里渲染，`Layout` 又把它限死在
   `/my-skills` 路由 —— **其它页面根本没有这个弹层**，所以不跳页就弹不出来

- [x] `service.mjs`：`get_skill_activity` 增加 `usageSkillId` —— 严格匹配对不上时按
      「技能名在库里唯一」再认一次（与调用统计同一口径），**不改 `managedSkillId` 可逐条追溯的语义**
- [x] `ActivityDetailPanel`：入口改用 `managedSkillId ?? usageSkillId`；弱匹配时按钮旁标注
      「按技能名匹配」（悬停解释），不把弱关联说成确定关联
- [x] `Layout`：为**非技能库页**挂一份全局 `SkillDetailPanel`（技能库页保留自己那份带部署开关的），
      弹层从此可跨页弹出
- [x] `SkillActivity` / `Dashboard`：打开详情不再 `navigate`，关掉就回到原处
- [x] `SkillDetailPanel`：返回按钮文案随来源页变化（技能库页「返回技能库」，其它页「返回」）
- [x] i18n：`activity.openSkillByName` / `openSkillByNameHint`、`mySkills.detail.backGeneric` 中英繁

**验证**（`output/activity-layout/verify-open-skill.mjs`，真实库 + 无头 Chrome，**6/6 ✓**）

| 断言 | 实测 |
| --- | --- |
| 右栏给出「打开技能详情」入口 | 20 条中 **10 条**可跳（其中 4 条按名称兜底）／未关联 10 条（**改动前 0 条**） |
| 点开后技能详情弹层打开 | ✓ |
| 打开详情后当前路由不变 | `pathname=/skill-activity` ✓ |
| 返回按钮写「返回」而非「返回技能库」 | ✓ |
| 关掉详情后回到调用记录页 | ✓ 列表 20 行 + 右栏仍在 |

剩下 10 条「未关联」是真的不在技能库里的技能（或名字不唯一），仍保持原提示。
`tsc` / `lint` / `build` 全绿。

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
