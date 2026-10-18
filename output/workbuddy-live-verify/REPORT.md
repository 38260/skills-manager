# WorkBuddy 实测验收报告（修复后复测）

日期：2026-10-18 10:49–11:52
客户端：WorkBuddy 5.8.3（`D:\IDE\Workbuddy\WorkBuddy.exe`）
被测系统：Skills Manager（`http://127.0.0.1:14200`，解析器版本 6）
活动库：`C:\Users\<user>\.skills-manager-activity\usage.db`

## 结论

第一轮发现的 4 个解析缺陷已全部修复并复测通过；复测过程中又发现并修复了 1 个真实日志形态缺陷（技能芯片的双反斜杠路径）。修复后重新对账了真实活动库，并用 WorkBuddy 产生 5 个新的独立会话逐项验收：

- 显式选择 → `manual/returned`
- 明确要求自选 → `automatic/returned`
- 点名但未执行 → 仅一条 `manual/pending` 请求，使用次数不增加
- 仅提及/否定 → 0 条活动记录
- 普通任务隐式触发 → `unknown/returned`（捕获使用，但不把隐式当自动）
- 重复扫描、真实后端重启 → 总数与分类保持不变

最终 WorkBuddy 记录 88 条，页面、API、数据库与原始日志重放四方一致。**本轮验收通过。**

D5（WorkBuddy 读取 `SKILL.md` 的文档加载未采集）保留为明确的范围决定：WorkBuddy 的技能执行以 `Skill` 工具调用为权威信号，同一会话内的 `Read SKILL.md` 属于执行细节，若同时记为文档加载会把一次使用计成两次，因此不采集；`已确认加载` 对 WorkBuddy 为 0 是预期结果，不是漏记。

## 缺陷与修复

| 编号 | 缺陷 | 修复 | 回归测试 |
| --- | --- | --- | --- |
| D1 | 技能芯片 `@skill:"...\SKILL.md"` 未识别为手动 | `context.mjs` 支持带引号路径、`<manually_attached_skills>` 的 `name:`/`path:`，并保留 `skillPath` | `activity-workbuddy.test.mjs` 显式芯片用例 |
| D2 | “请自动选择技能”未识别为自动 | `user-instructions.mjs` 先提取 `<user_query>`，`context.mjs` 在其上做锚定匹配 | 自动选择用例 |
| D3 | `Please use the Skill tool...` 被误记成技能 `tool` | 剥离 `<system-reminder>` / `<manually_attached_skills>`，自然语言规则只接受正向点名 | 真实消息形态用例，断言无 `tool` 请求 |
| D4 | 点名但未执行完全漏记 | 清理后的用户指令参与点名匹配，未匹配到调用时登记请求 | 点名未执行用例 |
| V6 | 芯片路径按 JSON 再转义后是双反斜杠，`skillFromPath()` 拆出空段并把整条路径当技能名 | `skillFromPath()` 按连续分隔符切分 | 双反斜杠路径用例 |
| — | 历史误解析记录残留 | 备份后删除 7 条陈旧请求（6 条 `tool` + 1 条路径名） | `repair-report.json`：删除后 84 条与重放完全一致 |

解析器版本：4 → 5（用户指令/选择/自动/请求）→ 6（转义反斜杠路径）。版本变化会强制重读历史日志，UPSERT 不会删除陈旧行，因此清理按定向对账执行。

## 复测矩阵（修复后，新会话）

| 用例 | 用户输入 | 原始日志 | 活动库 | 结果 |
| --- | --- | --- | --- | --- |
| 显式选择 | 芯片 `@skill:"...\\eli5\\SKILL.md"` + 解释请求 | `Skill {skill:"eli5"}` 第 7 行，completed | 1 条 `eli5 / invocation / manual / returned`，行 7 | 通过 |
| 自动选择 | 请自动选择技能，帮我查一下今天最新的 AI 新闻… | `Skill {skill:"aihot"}` 第 7 行，completed | 1 条 `aihot / invocation / automatic / returned`，行 7 | 通过 |
| 点名未执行 | 请使用 eli5 技能来回答…不要实际调用任何工具或技能 | 无任何 `function_call` | 1 条 `eli5 / request / manual / pending`，行 3 | 通过 |
| 仅提及/否定 | eli5 这个技能是做什么的？只回答描述，不要调用… | 仅 `Read SKILL.md` | 0 条 | 通过（无虚假调用/请求） |
| 隐式触发 | 给五岁小孩解释一下什么是量子纠缠，三句话以内 | `Skill {skill:"eli5"}` 第 7 行，completed | 1 条 `eli5 / invocation / unknown / returned`，行 7 | 通过 |

会话与调用：

- 显式：`5d8d16bc-5dfa-4ae7-8621-58393a37a9d8`（`d-AI-Workbuddy-2026-10-18-11-35-16`），`call_00_SNG3pw1Qz4OtDIG4rnfU5843`
- 自动：`f8a7557b-8830-4518-a464-1ce76f2b8d58`（`d-AI-Workbuddy-2026-10-18-11-38-47`），`call_00_VMnELSbPbdmcDevELo3i5959`
- 点名未执行：`3012d3c1-2ef0-468a-ae39-ba677f295891`（`d-AI-Workbuddy-2026-10-18-11-40-53`），`request:01a14d19-2b02-7a20-b7e9-98db2166de43`
- 仅提及：`9b2762ba-13c4-43b9-93ca-dd47c8b2a08d`（`d-AI-Workbuddy-2026-10-18-11-42-22`）
- 隐式：`9d641f09-7b76-4fad-8855-4c8216b8eb65`（`d-AI-Workbuddy-2026-10-18-11-43-42`），`call_00_aUp045fTVoqthSrhhwYK4891`

## 计数核对

活动库修复前：91 条 WorkBuddy 记录（含 7 条陈旧请求）。
备份并清理后：84 条 = 手动调用 7 + 自动调用 1 + 来源未知调用 69 + 手动请求 7。全量重放 495 个文件后 expected 84 = actual 84，0 missing、0 stale。

四轮新增真实使用后：**88 条 = 手动调用 8 + 自动调用 2 + 来源未知调用 70 + 手动请求 8**。

- 全量重放（500 个文件，0 解析错误）：expected 88 = actual 88，`stale=[]`、`missing=[]`；仅存在重复日志副本导致的 `sessionId`/`sourcePath` 溯源差异，不影响计数。
- 页面（WorkBuddy 筛选）：全部 88、明确调用 80、已确认加载 0、仅请求/待确认 8；手动触发 8、自动触发 2、来源未知 70。
- API `get_skill_activity`：`{invocation:80, document:0, request:8, manual:8, automatic:2, unknown:70}`，无 `tool` 或 `SKILL.md` 技能名。
- 技能使用：`eli5` 5 次（最后 11:43）、`aihot` 3 次（最后 11:38）；点名未执行的请求没有增加使用次数。技能卡与 `get_skill_usage` 一致。

## 幂等与持久化

- 连续两次 `scan_skill_activity`：仍为 88 条，重复 ID 0。
- 通过应用自身 `restart_app` 重启后端：PID 46684 → 42504；再次扫描后仍为 88 条，分类不变，四个复测会话记录全部保留。
- 页面刷新后统计不变。

## 验收表

| 验收项 | 标准 | 结果 |
| --- | --- | --- |
| 真实使用可追溯 | 原始日志 → 活动库 → API/页面 → 使用计数 | 通过 |
| 显式选择分类 | 手动触发 | 通过 |
| 自动选择分类 | 自动触发 | 通过 |
| 隐式触发捕获 | 捕获真实使用；证据不足保留未知 | 通过（未知 70 条，未被误升为自动） |
| 点名但未执行 | 只记请求，不增加使用 | 通过 |
| 仅提及/否定使用 | 不产生虚假调用或请求 | 通过 |
| 状态展示 | 已返回/失败/等待结果 | 通过（复测调用均已返回；请求为等待结果） |
| 重复扫描 | 计数不膨胀 | 通过 |
| 页面刷新 | 计数不膨胀 | 通过 |
| 后端重启 | 记录与分类持久 | 通过 |
| 分类与计数符合实际 | 页面/API/库/重放一致 | 通过 |
| 文档加载 | WorkBuddy `Read SKILL.md` | 未采集（D5 范围决定，见结论） |

## 证据文件

> 提交的证据文件中，用户主目录已脱敏为 `<user>`；`backups/` 中的真实活动库备份仅保留在本地，不提交。

- `retest-live.json`：5 个复测会话的原始调用、活动库记录、最终组成与使用计数
- `api-after-live.json`：WorkBuddy 筛选后的 `get_skill_activity` 结果
- `usage-after-live.json`：最终 `get_skill_usage`
- `analysis-final.txt`：500 个日志文件全量重放与数据库对账（expected 88 = actual 88）
- `repair-report.json`、`analysis-after-fix.json`、`backups/usage-before-repair-*.db`：修复前的备份与清理审计
- 第一轮证据：`evidence.json`、`report.json`、`restart-report.json`、截图与脚本 `probe.mjs` / `collect-evidence.mjs` / `analyze-workbuddy.mjs` / `repair-workbuddy.mjs`

## 说明与未执行项

- 复测期间只查看了运行中的技能库与调用记录页面，没有执行安装、卸载、分类修改或更新检查等写操作。Skills Manager 界面/启动流程自带的更新检查可能已更新技能更新元数据，这是应用的既有行为，不影响活动库和技能文件。
- WorkBuddy AI 与其他客户端未测试（本轮只按要求测试 WorkBuddy）。
- 没有修改真实技能文件；活动库的唯一写操作是经备份的 7 条陈旧请求清理，以及随后由真实使用产生的记录。
