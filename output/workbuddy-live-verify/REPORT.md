# WorkBuddy 实测验收报告

日期：2026-10-18 10:49–11:10
被测客户端：WorkBuddy 5.8.3
被测系统：Skills Manager（运行中后端 `127.0.0.1:14200`，未重启）

## 结论

真实调用链路可用：3 次真实的 `Skill` 工具调用都能从原始 JSONL 追踪到活动库、页面详情和技能使用计数。但触发来源分类与“仅请求”语义存在 4 个可复现的解析缺陷：

1. 显式技能芯片选择被记为“来源未知”，而不是手动触发。
2. “请自动选择技能”被记为“来源未知”，而不是自动触发。
3. 附加技能说明里的 `Please use the Skill tool...` 被误解析成名为 `tool` 的待确认请求。
4. “点名但未执行”没有生成请求记录。

因此本轮**不通过**“分类与计数符合实际”的验收项；调用捕获、未执行不计入使用、重复扫描不膨胀三项通过。

## 验收表

| 验收项 | 标准 | 结果 | 说明 |
| --- | --- | --- | --- |
| 真实使用可追溯 | 原始日志 → 活动库 → 页面 → 计数 | 通过 | 3 条调用均有 sessionId、callId、行号、来源文件 |
| 显式选择分类 | 手动触发 | **失败** | `eli5` 调用为来源未知；另有虚假 `tool` 请求 |
| 自动选择分类 | 自动触发 | **失败** | `aihot` 调用为来源未知 |
| 隐式触发捕获 | 捕获调用，证据不足时保留未知 | 通过 | `eli5` 隐式调用被捕获，来源未知 |
| 点名但未执行 | 只记请求，不增加使用 | **失败** | 0 条记录；用法计数没有增加（这一半符合） |
| 仅提及/否定使用 | 不产生虚假调用 | 通过 | 只读 SKILL.md，无 Skill 调用，无活动记录 |
| 普通任务未用技能 | 不产生技能记录 | 通过 | 只调用 WebSearch |
| 重复扫描 | 计数不膨胀 | 通过 | 连续两次扫描，使用统计指纹一致 |
| 页面刷新 | 计数不膨胀 | 通过 | 仍为 88 / 77 / 0 / 11 |
| 重启持久化 | 记录保留 | 通过 | 一致性数据库快照 + 隔离后端启动，读到 88 条 |
| 状态展示 | 成功/失败/待确认 | 通过 | 3 条调用“已返回”；虚假请求“等待结果” |
| 分类与计数符合实际 | 组成正确 | **失败** | 见下方组成差异 |

## 计数核对

- 测试前基线：workbuddy 84 = 手动调用 5 + 来源未知调用 69 + 手动请求 10
- 测试后实际：workbuddy 88 = 手动调用 5 + 来源未知调用 72 + 手动请求 11
- 解析正确时应为：手动调用 6 + 自动调用 1 + 来源未知调用 70 + 手动请求 11 = 88

差异来源：

- 显式 `eli5` 调用：应从来源未知改为手动。
- 自动 `aihot` 调用：应从来源未知改为自动。
- 虚假 `tool` 请求：应删除。
- 缺失的 `eli5` 请求：应在“点名但未执行”会话中出现（会话 `f8046e60...`）。

技能使用计数：

- `eli5`：3 次，最后使用 11:03（历史 1 + 显式测试 1 + 隐式测试 1）
- `aihot`：2 次，最后使用 10:53（历史 1 + 自动测试 1）

页面技能卡与 `get_skill_usage` 一致。

## 缺陷与根因

### D1 显式技能芯片未识别为手动

原始用户消息（第 3 行）在 `<user_query>` 中写入：

```text
@skill:"C:\\Users\\<user>\\.workbuddy\\skills\\eli5\\SKILL.md" 用最简单的比喻解释...
```

`backend/activity/context.mjs:36` 的显式匹配：

```js
/@skill:([\w.:-]+)/u
```

遇到第一个双引号即停止，无法匹配带引号的路径；`<manually_attached_skills>` 中已有的 `name: eli5` / `path: ...` 也没有被利用。

结果：`eli5` 调用（第 7 行）被记为 `trigger=unknown`。

### D2 自动选择未识别

用户原话：

```text
请自动选择技能，帮我查一下今天最新的 AI 新闻，给我三条并附来源。
```

`backend/activity/context.mjs:47` 的 `autoChoice` 正则锚定在整段用户内容的开头：

```js
/^(?:请)?(?:自行|自动)选择(?:合适的)?技能|.../.test(text.trim())
```

WorkBuddy 的用户内容以 `<system-reminder data-role="user-context">` 开头，真正指令在末尾的 `<user_query>` 中，锚定失败。

结果：`aihot` 调用（第 7 行）被记为 `trigger=unknown`。

### D3 虚假 `tool` 请求

同一会话第 3 行的附加技能块包含：

```text
<manually_attached_skills>
Please use the Skill tool to invoke this skill.
name: eli5
...
```

`backend/activity/context.mjs:41` 的英文自然语言规则把 `Please use the Skill tool` 捕获成技能名 `tool`；`backend/activity/user-instructions.mjs` 没有剥离 `<system-reminder>` / `<manually_attached_skills>`。

结果：数据库中出现 `skillName=tool`、`kind=request`、`trigger=manual`、`status=pending`、`sourceLine=3` 的记录。页面显示 `tool / 等待结果`。

### D4 “点名但未执行”完全漏记

用户原话：

```text
请使用 eli5 技能来回答：什么是数据库索引？但这次只说明你会怎么用这个技能，不要实际调用任何工具或技能。
```

WorkBuddy 写入格式为：

```text
</system-reminder>
<user_query>请使用 eli5 技能来回答...</user_query>
```

自然语言规则要求 `^` 或换行后紧跟“请使用”，但 `请` 前面是 `<user_query>`，不是换行或空白，因此没有匹配。`userInstructionText` 也没有先提取 `<user_query>`。

结果：该会话没有任何工具调用（Agent 按要求未执行），活动库中也没有请求记录；无法区分“未点名”与“点名但未执行”。

### D5 文档读取未采集（覆盖缺口，非误报）

反例会话说“只回答描述”，WorkBuddy 读取了 `C:\Users\<user>\.workbuddy\skills\eli5\SKILL.md`（原始日志第 7 行 `Read`），没有调用 `Skill`。`backend/activity/workbuddy.mjs` 只处理 `name === "Skill"` 的调用，因此这次真实的文档读取没有进入活动库。页面 WorkBuddy 的“已确认加载”始终为 0。

这不会造成虚假调用，但无法满足“调用、文档读取、仅请求”三类的完整链路核对。

## 建议修复范围

1. `backend/activity/user-instructions.mjs`
   - 优先提取 `<user_query>...</user_query>` 的内容，再执行现有的代码块/引用清理。
   - 剥离 `<system-reminder>...</system-reminder>` 与 `<manually_attached_skills>...</manually_attached_skills>`，避免系统提示进入指令解析。

2. `backend/activity/context.mjs`
   - 解析 `<manually_attached_skills>` 中的 `name:` / `path:` 对，作为显式选择。
   - 扩展 `@skill:`：支持 `@skill:"C:\...\SKILL.md"` / `@skill:'...'`，路径用 `skillFromPath()` 推导技能名，并保留 `skillPath`。
   - 自然语言点名与 `autoChoice` 改为在提取后的 `<user_query>` 文本上运行。
   - 确保 `Please use the Skill tool...` 不再命中。

3. `backend/activity/scanner.mjs`
   - `PARSER_VERSION` 从 4 升到 5，让历史文件重新解析。

4. 测试
   - 现有 `tests/backend/activity-workbuddy.test.mjs` 的 2 项测试通过，但夹具只用了裸消息，没有覆盖 WorkBuddy 真实的 system-reminder + manually_attached_skills + user_query 结构，所以没有暴露 D1–D4。
   - 增加真实消息形态的夹具：显式芯片、自动选择、点名未执行、否定、隐式触发、普通任务。
   - 断言触发方式、请求状态、虚假 `tool` 不再出现。

5. 数据清理
   - 修复后重扫会把 `eli5` / `aihot` 的 `trigger` 自动升级为 `manual` / `automatic`（UPSERT 允许 unknown 被覆盖）。
   - 已写入的 `tool` 请求不会被重扫删除，需要一次定向清理或通用的“重解析后对账删除”机制。修改真实活动库前必须先备份并取得确认。

6. D5（可选，第二阶段）
   - 在 `backend/activity/workbuddy.mjs` 中识别 `Read` 读取 `SKILL.md` 的调用，记为 `kind=document`，并复用 `pending` → `document` 的状态规则。

## 证据文件

- `evidence.json`：6 个测试会话的脱敏原始日志摘要 + 活动库记录
- `report.json`：两次扫描与使用统计指纹
- `restart-report.json`：隔离后端重启持久化结果
- `activity-workbuddy.png`：WorkBuddy 筛选后的调用记录页（88 / 77 / 0 / 11）
- `detail-false-request-tool.png`：虚假 `tool` 请求详情
- `detail-auto-aihot.png`：`aihot` 自动选择会话详情（来源未知）
- `detail-explicit-eli5.png`：`eli5` 显式选择会话详情（来源未知）
- `usage-eli5.png` / `usage-aihot.png`：技能卡使用次数
- 脚本：`probe.mjs`、`collect-evidence.mjs`、`restart-persistence.mjs`

## 未执行项

- WorkBuddy AI 未测试（本轮只按要求测试 WorkBuddy）。
- 其他客户端未测试。
- 未重启用户正在运行的 SkillManager 实例；用隔离后端 + 数据库快照验证持久化。
- 未修改代码、未清理真实活动库、未处理 D1–D5。
