# DSH（DeepSeek Harness）实测验收报告

日期：2026-10-18 12:15–12:50
客户端：DeepSeek Harness（`ws-9d3c95405d12 Harness.exe`），模型 `Deepseek-V4.1-Flash · x0.00 · Free now`，推理等级 Max
被测系统：Skills Manager（`http://127.0.0.1:14200`，解析器版本 7）
日志：`C:\Users\<user>\.dsh\sessions\<工作区>\session-<id>\session.v4.jsonl.zstd`（多帧 Zstandard）

## 结论

按 WorkBuddy 同一矩阵实机跑完 5 个用例。**第一轮就发现一个新缺陷 D6**：DSH 用户在技能菜单里点选技能时，客户端不调用 `skill` 工具，而是把技能正文直接注入成一条消息；旧解析器完全忽略这条路径，真实使用一条都没记上。修复并升到解析器版本 7 后复测，5 个用例全部符合预期。

## D6：菜单点选的技能调用被整条漏记

实机操作：`/` 打开候选列表 → 点选 `animation-vocabulary` → 输入问题 → 发送。原始日志里出现的是：

```text
line 10  user/message  source.kind=user              "/animation-vocabulary  popover 打开时那种微微回弹的效果叫什么名字？…"
line 13  user/message  source.kind=skill-catalog     <available_skills>…
line 14  user/message  source.kind=skill-invocation  <skill_content name="animation-vocabulary">…
```

全程没有 `tool/call`。而 `backend/activity/dsh.mjs` 只处理 `tool/call name==="skill"`，因此这次真实使用在活动库里是 0 条记录（扫描后确认）。

与 WorkBuddy 的区别：WorkBuddy 点选后仍会调用 `Skill` 工具，DSH 点选是客户端直接注入，模型自己决定用时才走 `skill` 工具（本轮的自动选择和隐式触发用例都证实了这一点）。两条路径互斥：全部 31 个历史 DSH 日志里 `skill-invocation` 只出现 1 次，就是本次实测。

修复：`dsh.mjs` 识别 `source.kind === "skill-invocation"`，取 `source.name` 记为一次已返回的调用。因为该消息只在用户从菜单点选时产生，所以按用户的显式选择处理（`trigger=manual`、`evidence=user_selection`），并复用「同一技能已有选择就取消待确认请求」的既有规则，不会与后续 `skill` 工具调用重复计数。`PARSER_VERSION` 6 → 7。

回归测试：`tests/backend/activity-dsh.test.mjs` 新增「菜单点选注入的 skill-invocation 记为手动调用」，断言只记 1 条、类型/触发/状态/依据齐全。

## 复测矩阵（解析器 7）

| 用例 | 操作 | 原始日志 | 活动库 | 结果 |
| --- | --- | --- | --- | --- |
| 显式选择（菜单点选） | `/` 列表点选 `animation-vocabulary` | line 14 注入技能正文，无 `skill` 工具调用 | `invocation / manual / returned`，行 14 | 通过 |
| 明确要求自选 | 「请自动选择技能，帮我判断…」 | line 20 `tool/call skill {"name":"animation-vocabulary"}`，结果 isError=false | `invocation / automatic / returned`，行 20 | 通过 |
| 点名但未执行 | 「请使用 animation-vocabulary 技能…只说明你会怎么用，不要实际调用任何工具或技能」 | 0 个 `tool/call` | 仅 1 条 `request / manual / pending`，行 10 | 通过 |
| 仅提及/否定 | 「animation-vocabulary 这个技能是做什么的？只回答它的描述，不要调用任何技能」 | 0 个 `tool/call` | 0 条 | 通过 |
| 普通任务隐式触发 | 「popover 打开时那种微微回弹的效果该叫什么名字？」 | line 19 `tool/call skill` | `invocation / unknown / returned`，行 19 | 通过 |

会话：

- 显式点选：`session-597bc09db3a7`（注入消息 id `6c8a21d92431`）
- 自动选择：`session-86819678f84f`（`call_00_4qWuctPZHjukBATravrB6761`）
- 点名未执行：`session-17c0f0d7c001`
- 仅提及：`session-07036ff5a77d`
- 隐式触发：`session-39059fa33753`（`call_00_uFzT0zKS0rfI81I6BtFP9576`）

## 计数核对

- 测试前基线：DSH 6 条（全部 `unknown/returned`，来自历史的 `skill` 工具调用）
- 测试后：**11 条 = 手动调用 1 + 自动调用 1 + 来源未知调用 7 + 手动请求 2**
- 新增 5 条中：3 条调用（手动 1、自动 1、未知 1）+ 2 条请求
- 两条请求的来源：一条是「点名但未执行」用例；另一条是显式点选会话里的第二条消息——用户用自然语言再次点名，但技能正文已在同一会话上下文中，模型没有再调用，因此按规则只记待确认请求
- `animation-vocabulary` 使用计数 3（注入 1 + 自动 1 + 隐式 1），请求不计入
- WorkBuddy 计数保持 89，未受影响

页面（DSH 筛选）：全部记录 11、明确调用 9、已确认加载 0、仅请求/待确认 2；手动触发 1 · 自动触发 1 · 来源未知 7。API `get_skill_activity` 返回 `{"invocation":9,"document":0,"request":2,"manual":1,"automatic":1,"unknown":7}`（total 11），与库一致；记录详情面板对注入记录显示「手动触发 / 用户明确选择，并与本次技能关联 / 行号 14」。`get_skill_usage` 里 `animation-vocabulary` 为 3 次。

## 幂等与持久化

- 连续两次 `scan_skill_activity`：DSH 仍为 11 条，全库重复 ID 0，已扫描文件 1014
- 应用自身 `restart_app` 重启后端（PID 30492 → 49272）后再次扫描：DSH 11 条、WorkBuddy 89 条，分类不变

## 副作用说明

- DSH 会话的工作区是界面里已选中的 `ws-478046147e5a`（不是本轮新建的目录）。所有用例都要求只回答文本，实测后按修改时间核查该目录，25 分钟内无任何文件变动。
- 为降低风险，第一个用例之后把 DSH 的访问模式从「工作区内修改」改成「仅可查看」，其余 4 个用例在只读策略下运行（日志里的 runtime-context 也记录了 `file policy: read-only`）。**这是我在本轮改掉的客户端设置，仍是只读方向；如需恢复成原来的「工作区内修改」，在输入框下方「访问模式」里改回即可。**
- Skills Manager 侧只做了查看与筛选，没有执行安装、卸载、分类修改或更新检查；后端为本轮加载新解析器重启过 2 次。

## 复测（2026-10-18 14:15–14:20，解析器 8）

为确认 D6 修复稳定，重新用电脑操控跑了 3 个新会话（模型仍是 `Deepseek-V4.1-Flash · x0.00 · Free now`）：

| 用例 | 原始日志 | 活动库 | 结果 |
| --- | --- | --- | --- |
| 菜单点选 `animation-vocabulary` | line 14 `source.kind=skill-invocation`，无 `skill` 工具调用 | `invocation / manual / returned`，`evidence=user_selection` | 通过 |
| 点名但要求不执行 | 0 个 `tool/call`、0 条注入 | 仅 1 条 `request / manual / pending` | 通过 |
| 要求自动选择 | line 24 `tool/call skill {"name":"animation-vocabulary"}` | `invocation / automatic / returned`，`evidence=user_auto_choice` | 通过 |

- DSH 计数 11 → **14**（手动 1→2、自动 1→2、未知 7 不变、请求 2→3）
- `animation-vocabulary` 使用 3 → **5**（+菜单点选 +自动选择；未执行的那条只记请求，没加使用）
- 连续两次 `scan_skill_activity`：仍 14 条，全库重复 ID 0
- API `get_skill_activity`（tool=dsh）：`{invocation:11, document:0, request:3, manual:2, automatic:2, unknown:7}`，技能名只有 `animation-vocabulary`、`diagnose-windows-sandbox-acl`、`pdf-converter`，无异常名字
- 会话：`session-ca49478a-…`（点选）、`session-f7b3cbf0-…`（点名未执行）、`session-5089d8d9-…`（自动选择）

**新发现（不是 Skills Manager 的问题）**：DSH 的「访问模式」是**按会话生效**的，新建会话会退回默认的「工作区内修改」。上一节把会话改成只读之后，再点「新建会话」，第一个复测用例其实是在 `workspace-write` 策略下跑的（日志 `runtime-context` 记着 `file policy: workspace-write`）。已核实该工作区 `ws-478046147e5a` 在测试时段内没有任何文件变动；后两个用例改为「先建会话、再设只读」，日志里是 `read-only`。

## 证据文件

- `dsh-live.json`：5 个用例的原始日志要点（用户消息、`skill` 工具调用、注入消息）+ 活动库记录 + 最终计数
- `api-dsh.json`：首轮 DSH 筛选的 `get_skill_activity` 结果
- `api-dsh-retest.json`：复测后 DSH 筛选的 `get_skill_activity` 结果
- `usage-all.json`：最终 `get_skill_usage`
- `collect-dsh-evidence.mjs`：证据汇总脚本

## 未执行项

- DSH 的「已确认加载」仍为 0：DSH 没有独立的技能文档读取信号，注入消息已按调用记录，不再重复采集
- WorkBuddy AI、ZCode、Codex 客户端本轮未做实机测试
