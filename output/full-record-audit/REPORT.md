# 全量记录审计（六来源重放对账）

日期：2026-10-18 13:56–14:20
解析器版本：8
目的：确认「引用型/合成文本被当成用户点名」这类缺陷（D3 虚假 `tool`、V6 路径当名、D7 压缩摘要）在所有来源里已无残留。

## 做法

`audit-all.mjs` 用当前解析器重放每个已启用来源的全部日志，与真实活动库逐条按事件 ID 比对，并做两项检查：

- **结构检查**：技能名必须匹配 `^[A-Za-z0-9\u4e00-\u9fff][A-Za-z0-9._:\u4e00-\u9fff-]*$`，且不含 `...`、不叫 `tool`/`skill`、长度 ≤ 48
- **对账检查**：`stale`（库里有、重放没有 = 历史误解析残留）、`missing`（重放有、库里没有 = 漏记）

## 结果

| 来源 | 文件 | 解析错误 | 重放期望 | 库内实际 | 残留 | 漏记 |
| --- | --- | --- | --- | --- | --- | --- |
| codex | 85 | 0 | 81 | 110 | 29（全部源文件已不在磁盘） | 0 |
| dsh | 38 | 0 | 14 | 14 | 0 | 0 |
| qoder | 68 | 0 | 9 | 9 | 0 | 0 |
| workbuddy | 501 | 0 | 89 | 89 | 0 | 0 |
| workbuddy_ai | 94 | 0 | 22 | 22 | 0 | 0 |
| zcode | 1 | 0 | 12 | 12 | 0 | 0 |

可疑技能名：**0**。

codex 的 29 条差异不是解析残留：它们的 `sourcePath` 指向 16 个已被 Codex 清理掉的 rollout 文件（其中 19 条是 `document/returned`，即真实发生过的技能文档加载）。日志没了但仍符合「记录持久保留」的口径，**不删除**。

## 逐个核过的可疑名字

| 名字 | 来源 | 结论 |
| --- | --- | --- |
| `v2.1` | zcode | 真实用户原话「使用v2.1技能测试：…」，未执行 → 只记待确认请求，符合口径 |
| `资料库`、`project` | workbuddy | 原始日志里确实是 `function_call name:"Skill"`，是 WorkBuddy 内置专家技能的真名 |
| `skills` | codex | 读的是 `<插件>/5.2.0/skills/SKILL.md`，技能名由路径父目录推导而来；是 `request`（未确认加载），不计入使用 |
| `...`、`eli5`（Qoder） | qoder | D7 压缩摘要造成的假点名，已修复并清理，全库现为 0 |

## 同类风险排查

扫描全部 726 个日志文件里含「This session is being continued / ran out of context」的行：

- workbuddy / workbuddy_ai / codex / dsh：0 行 —— 这些来源不注入压缩摘要
- qoder：16 行，其中 9 行是带 `isCompactSummary` 标记的合成用户消息（v8 已跳过），另外 7 行是 `tool_result` 与 assistant 行，只是内容里引用了摘要文字；解析器本来就不把 `tool_result` 当用户消息，也不从 assistant 行取点名

结论：这一类问题只有 Qoder 会有，且已按结构化标记关闭，无其它来源的残留风险。

## 计数快照（审计后）

codex 110、workbuddy 89、workbuddy_ai 22、zcode 12、dsh 14、qoder 9。
连续两次 `scan_skill_activity` 后各来源计数不变，全库重复事件 ID 为 0。

## 证据

- `audit-all.mjs`：审计脚本（只读，不写库）
- `audit-report-after-dsh.json`：DSH 复测后的完整对账输出（用户目录已脱敏）
- `usage-all.json`：`get_skill_usage` 快照
