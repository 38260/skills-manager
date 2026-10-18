# Qoder 压缩摘要被当成用户点名（D7）

日期：2026-10-18 13:44–13:52
现象：调用记录里出现一条 `技能名 = "..."`、Qoder、手动触发、识别依据「用户明确选择，并与本次技能关联」的待确认请求（10/18 10:56）。

## 根因

Qoder 在上下文压缩边界会注入一条**合成的用户消息**（`isCompactSummary: true`），内容是整段历史会话摘要。摘要里会原样引用用户过去说过的话，例如：

```text
- 用户原话：...
- 请使用 eli5 技能来回答：什么是数据库索引？
```

`backend/activity/qoder.mjs` 之前只按「是不是用户消息」判断，把这条摘要也喂给 `ParseContext.user()`。点名正则的技能名字符类是 `[\w.:-]+`，包含英文句点，于是省略号被抽成技能名 `...`；被引用的历史点名句式又抽出一条假的 `eli5` 请求。

这与已经处理过的 Codex 审批历史是同一类问题：**引用型文本不是当前指令**。

## 修复

- `backend/activity/qoder.mjs`：`row.isCompactSummary === true` 的用户消息直接跳过（按结构化标记判断，不靠文案前缀）。
- `backend/activity/scanner.mjs`：`PARSER_VERSION` 7 → 8，强制历史日志重读。
- `tests/backend/activity-qoder.test.mjs`：新增真实形态回归测试（摘要含点名句式与省略号 + 其后一条「继续」），断言 0 条请求。

## 真实库对账与清理

`analyze-qoder.mjs` 用修复后的解析器重放全部 68 个 Qoder 日志（18 条压缩摘要行）：

- 期望 9 条，实际 11 条 → 陈旧 2 条、缺失 0 条、解析错误 0
- 两条陈旧记录都是 `kind=request / manual / pending`，且都来自压缩摘要：`"..."`（行 332）与 `eli5`（行 1498）
- 备份 `backups/usage-before-qoder-repair-2026-10-18T05-44-48-154Z.db`（清理前 Qoder 11 条）
- `--repair` 只删「重放不再产生且确实是 request」的行；脚本对任何非 request 的陈旧记录会直接拒绝执行
- 清理后剩 9 条，与重放完全一致；`skillName = "..."` 的记录在全库已为 0

其它来源未受影响：codex 110、workbuddy 89、workbuddy_ai 22、zcode 12、dsh 11。
API `get_skill_activity`（tool=qoder）：total 9，`{invocation:8, document:0, request:1, manual:1, automatic:1, unknown:6}`。

## 顺带说明的两条终端输出

- `[vite] http proxy error: /api/events ECONNRESET` —— 后端重启时 SSE 连接被掐断，Vite 代理打的日志。前端用的是 `EventSource`，断线自动重连（`src/lib/transport.ts:63`），中断期间的事件不补发，属预期行为，不是缺陷。本轮为加载新解析器重启过多次后端，所以出现两次。
- `Browserslist: caniuse-lite is 8 months old` —— 依赖数据过期提醒，需要跑 `npx update-browserslist-db@latest`（会改 `package-lock.json` 与 node_modules）。属依赖更新，未擅自执行。

另外把 `vite.config.ts` 里开发模式拉起后端的命令加了 `--disable-warning=ExperimentalWarning`，只屏蔽后端 `node:sqlite` 每次启动打的那条实验性告警，其它告警照常显示；需要重启 `npm run dev` 生效。

## 验证

`test:backend` 103/103、`test:ui`、`test:electron`、`lint`、`build` 全绿。

## 证据

- `analyze-qoder.mjs`：重放对账脚本（默认只读比对，`--repair` 才写库）
- `api-qoder.json`：修复后 Qoder 筛选的接口结果（用户目录已脱敏）
