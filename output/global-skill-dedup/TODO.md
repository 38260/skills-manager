# 全局技能重复副本整理

日期：2026-10-18。用户已确认执行前一轮只读检查后的整理方案。

## 范围与保护

- 以 `C:/Users/luckyzyb/.skills-manager/skills` 为唯一技能内容来源。
- 只调整下表的五个实体副本；不修改技能正文、应用源码、数据库或工具启停设置。
- 原目录整体移至同一磁盘、技能扫描目录之外的 `skill-dedup-backups/2026-10-18`，验收前保留。
- 核对 `skill_targets` 后，这五个待调整实体路径均无部署绑定；既有绑定路径保持可访问。
- 同名但内容不同的 `find-skills`、`skill-creator`、`pdf` 保留。
- 保留任务开始时的全部用户修改及未跟踪文件，仅提交本任务验证脚本和记录。

## TODO

- [x] 0. 保存内容指纹、部署绑定及工作区基线，确认副本与中央库一致。
- [x] 1. `dashi-ppt`：移走 `.codex/skills/dashi-ppt`，保留 `.agents/skills/dashi-ppt` 共享入口。
- [x] 2. `archify`：将 `.agents/skills/archify` 改为指向中央库的 Junction。
- [x] 3. `design-taste-frontend`：将 `.agents/skills/design-taste-frontend` 改为 Junction。
- [x] 4. `web-design-guidelines`：将 `.agents/skills/web-design-guidelines` 改为 Junction。
- [x] 5. `ai-rereseach`：将 WorkBuddy 中的副本改为 Junction。
- [x] 6. 整体验证入口、备份、中央库、绑定、同名变体和原有工作区内容；重新扫描重复副本。
- [ ] 7. 用户在新开的 Codex 对话及 WorkBuddy 中验收技能识别。

## 验证与证据

在本仓库运行：

```powershell
node --disable-warning=ExperimentalWarning output/global-skill-dedup/verify.mjs capture
node --disable-warning=ExperimentalWarning output/global-skill-dedup/verify.mjs before dashi-ppt
node --disable-warning=ExperimentalWarning output/global-skill-dedup/verify.mjs after dashi-ppt
node --disable-warning=ExperimentalWarning output/global-skill-dedup/verify.mjs verify
```

`before` / `after` 的技能名可换成表中的其他四项。真实本机内容指纹和绑定快照位于既有 Git 忽略规则覆盖的 `output/global-skill-dedup/data/`，不提交用户数据。指纹包含说明、脚本、资源和 `.gitignore`，排除 Git 元数据、依赖和缓存；整个原目录均保留在备份中。

## 备份与恢复

| 技能 | 原入口 | 备份位置 |
| --- | --- | --- |
| dashi-ppt | `C:/Users/luckyzyb/.codex/skills/dashi-ppt` | `C:/Users/luckyzyb/.codex/skill-dedup-backups/2026-10-18/dashi-ppt` |
| archify | `C:/Users/luckyzyb/.agents/skills/archify` | `C:/Users/luckyzyb/.agents/skill-dedup-backups/2026-10-18/archify` |
| design-taste-frontend | `C:/Users/luckyzyb/.agents/skills/design-taste-frontend` | `C:/Users/luckyzyb/.agents/skill-dedup-backups/2026-10-18/design-taste-frontend` |
| web-design-guidelines | `C:/Users/luckyzyb/.agents/skills/web-design-guidelines` | `C:/Users/luckyzyb/.agents/skill-dedup-backups/2026-10-18/web-design-guidelines` |
| ai-rereseach | `D:/AICache/WorkBuddy/.workbuddy/skills/ai-rereseach` | `D:/AICache/WorkBuddy/.workbuddy/skill-dedup-backups/2026-10-18/ai-rereseach` |

恢复时先确认原入口为本任务创建、且仍指向中央库的 Junction，只移除联接本身，不递归删除；然后用 PowerShell `Move-Item -LiteralPath` 把对应备份移回原入口。`dashi-ppt` 原入口应为空，可直接移回。恢复前还需确认不存在用户新建内容。本任务不自动清理备份。

## 结果记录

基线已保存：五组共 780 个有效文件逐一比对一致，保存 53 条既有部署绑定、10 个用户已修改文件的指纹及原有未跟踪文件清单。验证脚本语法检查通过，真实快照目录已确认被 Git 忽略。

当前对话携带的是启动时的技能清单，入口调整后的界面识别需由新对话验收；不自动重启用户应用。

- 步骤 1：原 Codex 副本完整移入同盘备份；577 个技能文件的内容及原文件标识验证通过。旧入口已不存在，`.agents/skills/dashi-ppt/SKILL.md` 仍可读取且解析到中央库。
- 步骤 2：`archify` 原目录完整备份，新入口为指向中央库的 Junction；192 个技能文件及原文件标识核对通过。
- 步骤 3：`design-taste-frontend` 原目录完整备份，新入口及技能说明读取通过；内容和原文件标识核对通过。
- 步骤 4：`web-design-guidelines` 原目录完整备份，新入口指向中央库，技能说明读取及原文件标识核对通过。
- 步骤 5：WorkBuddy 的 `ai-rereseach` 原目录完整备份于 D 盘，原入口改为中央库 Junction；9 个技能文件及原文件标识核对通过。

## 整体测试

| 验证项 | 结果 |
| --- | --- |
| 默认全局目录、中央库及 Codex 插件缓存复扫 | 56 个候选根目录中 14 个存在，220 个技能入口、108 个实际目录，读取错误 0；相同内容的独立副本由 5 组降至 0 组 |
| 五项调整及备份 | 全部通过；780 个技能文件逐一比对，备份保留原 `SKILL.md` 文件标识 |
| 中央库 | 五个目标技能的内容与操作前相同，运行依赖和缓存未改动 |
| 既有部署绑定与工具设置 | 53 条绑定及工具设置逐字段相同；53 条绑定入口均可读取并正确解析至各自中央库 |
| 同名不同内容的技能 | `find-skills`、`skill-creator`、`pdf` 的 6 个变体内容保持不变 |
| 用户原有工作区 | 10 个已修改文件的 SHA-256 未变，15 个原有未跟踪文件仍存在 |
| 验证脚本与 Git | Node 语法检查及本任务 `git diff --check` 通过；真实快照与复扫摘要均已确认被 Git 忽略 |

首次整体检查发现 SQLite 返回的行对象无原型，与 JSON 快照的普通对象存在类型差异。已在验证脚本中将行转为普通记录，保留全部字段的严格比较，重新验证通过；数据库未写入。

本次未修改应用源码，因此未运行应用全仓库测试。未自动重启 Codex / WorkBuddy，也未触发技能执行；应用界面与实际调用由用户验收。五份原目录备份仍保留，不计入有效安装目录的复扫范围，也尚未释放其磁盘占用。

## Git 留痕

Git 记录本任务脚本与逐步操作结果；全局目录调整本身由备份和本机快照保证可恢复。

| Commit | 内容 |
| --- | --- |
| `cd84444` | 去重计划与基线验证脚本 |
| `7dce559` | dashi-ppt 冗余入口整理记录 |
| `d643aca` | archify 目录联接整理记录 |
| `d93c919` | design-taste-frontend 目录联接整理记录 |
| `d14d277` | web-design-guidelines 目录联接整理记录 |
| `4cbc864` | WorkBuddy ai-rereseach 目录联接整理记录 |

## 用户验收

1. 在 Codex 新开对话查看技能列表，确认 `dashi-ppt` 只显示一次，且其余三个 `.agents` 技能仍能识别。
2. 在 WorkBuddy 刷新技能列表或新开对话，确认 `ai-rereseach` 仍可识别。
3. 确认使用正常后，再决定是否清理上述五份备份；本任务不自动清理。
