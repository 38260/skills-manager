# ZCode 实机验收报告（LongCat 驱动 + GUI 操控）

日期：2026-10-18 15:20–16:20
客户端：ZCode 3.15.3 桌面端（`D:\AI\ZAI\ZCode\ZCode.exe`）
模型：自定义供应商「新供应商」→ `LongCat-2.5-Preview`（`https://api.longcat.chat/openai/v1`，Chat Completions）
被测系统：Skills Manager（`http://127.0.0.1:14200`，解析器版本 9）
会话库：`C:\Users\<user>\.zcode\cli\db\db.sqlite`（`session`/`message`/`part` 三表）

## 结论

按 WorkBuddy / DSH 同一矩阵，在 ZCode 桌面端用鼠标键盘实机跑完 5 个用例。**发现并修复一个新缺陷 D8**：ZCode 桌面端的技能芯片序列化成 `[$技能名](...\SKILL.md)`，开头的方括号让裸 `$技能名` 锚定失效，导致用户的显式点选被记成「来源未知」。修复后 5 个用例分类全部正确。

## D8：GUI 技能芯片未识别为显式点名

实机操作：`/` 打开候选面板 → 技能分组里点选 `$animation-vocabulary` → 输入问题 → 发送。会话库里留下的是：

```text
part text  [$animation-vocabulary](C:\Users\<user>\.agents\skills\animation-vocabulary\SKILL.md)  popover 打开时那种弹一下再落定的效果叫什么？…
part tool  {"tool":"Skill","state":{"input":{"skill":"animation-vocabulary","args":"…"},"status":"completed"}}
```

`backend/activity/context.mjs` 的显式点名规则只认消息**开头**的 `$技能名`，而芯片首字符是 `[`，于是 `Skill` 调用被记成 `trigger=unknown`。

修复：`explicitSelection` 增加一条锚定规则 `^\s*\[\$([\w.:-]+)\]\(([^)]+)\)`，技能名取捕获组、同时保留 `SKILL.md` 路径；`PARSER_VERSION` 8 → 9；`tests/backend/activity-zcode.test.mjs` 新增真实形态回归测试（断言 `manual / returned / user_selection`）。

## 复测矩阵（解析器 9，全部桌面端实机）

| 用例 | 输入 | 会话库 | 活动库 | 结果 |
| --- | --- | --- | --- | --- |
| 显式选择（`/` 面板点选芯片） | `[$animation-vocabulary](…SKILL.md) popover 弹一下再落定叫什么？` | 1 次 `Skill` 调用，completed | `invocation / manual / returned`，`user_selection` | 通过 |
| 明确要求自选 | 「请自动选择技能，帮我判断：鼠标悬停时卡片轻微上浮…」 | 1 次 `Skill` 调用 | `invocation / automatic / returned`，`user_auto_choice` | 通过 |
| 点名但不执行 | 「请使用 animation-vocabulary 技能回答…但这次只说明你会怎么用，不要实际调用任何工具或技能」 | 0 次调用 | 仅 1 条 `request / manual / pending` | 通过 |
| 仅提及/否定 | 「animation-vocabulary 这个技能是做什么的？只回答它的描述，不要调用任何技能」 | 0 次调用 | 0 条 | 通过 |
| 普通任务隐式触发 | 「想描述『列表滚到头还能继续拉、松手又弹回来』那种手感，术语叫什么？」 | 0 次调用（模型 7 秒直接答对，未加载技能） | 0 条 | 通过（没有真实使用就不记） |

会话（ID 前 8 位）：`bcc8d62c` 显式、`8a81acee` 自动、`a0122777` 点名未执行、`52d08ba3` 仅提及、`e24ebca1` 隐式。

隐式用例本轮没触发技能加载，因此「捕获但保留未知」这一路由 ZCode 历史里 10 条 `unknown/returned` 真实调用覆盖（都是模型自行调用 `Skill` 且用户没点名）。

## 计数核对

- 测试前基线：zcode 12 条（全部 `unknown/returned` 与 2 条历史请求）
- 测试后：**17 条 = 手动调用 2 + 自动调用 2 + 来源未知调用 10 + 手动请求 3**
- `animation-vocabulary` 使用计数随真实调用增长；三条请求一律不计入使用
- 版本升到 9 后重扫，把历史上同样用芯片点选的 ZCode 会话一起改判为手动（手动调用从 1 增至 2），没有出现反向误判
- API `get_skill_activity`（tool=zcode）：`{invocation:14, document:0, request:3, manual:2, automatic:2, unknown:10}`，total 17，与库一致；技能名里没有异常值

## 幂等与持久化

- 连续两次 `scan_skill_activity`：zcode 仍 17 条，全库重复事件 ID 0
- 应用自身 `restart_app` 重启后端（加载 v9）后重扫：zcode 17 条、分类不变，其它来源计数不变

## 副作用与需要你知道的事

1. **凭据录入**：安全策略不允许我在图形界面里自动输入 API Key（第一次尝试被拦截），所以密钥字段是**你手动粘贴**的，我没有读取或转存它。配置落在 `C:\Users\<user>\.zcode\v2\setting.json`（ZCode 自己的设置存储），不在本仓库。
2. **我改过又还原的东西**：为了先验证 key 可用，我往 `~/.zcode/cli/config.json` 加过一个 `provider.longcat`（用 `apiKeyEnv` 读环境变量，密钥不写文件）并设了 `model.main`。桌面端配好之后已把该文件**还原成原样**（备份 `config.json.backup-before-longcat-20261018-152131` 仍在）。
3. **权限模式**：桌面端「完全访问」是**按会话**生效的，新建会话会退回默认值；我在第一个用例上开过计划模式，其余用例新会话仍是完全访问。5 个 prompt 都是纯问答，跑完按修改时间核查 `D:\AIWorkSpace\test`，本轮 ZCode 会话没有写入该目录。
4. **测试期间该目录里出现的 `ai-complete-sounds/*.mp3` 与 `audition.html`（15:46:59）不是本轮产生的**：会话库检索无命中，来源是你在 `D--AIWorkSpace-test` 的另一个 Qoder 会话。
5. 本轮还在 ZCode 里留下了 5 个真实测试会话（列表标题如「查询 Popover 弹跳落定动画术语」「卡片悬停上浮效果术语咨询」等），以及更早 6 个用 CLI 跑的同名矩阵会话（`--cwd D:\AI\ZCode-test\2026-10-18`，CLI 的 `/skill` 被 Git Bash 转成了 `D:/env/Git/skill`，所以显式用例只在桌面端有效）。不需要的话可以在 ZCode 里删掉。

## 验证

`test:backend` 104/104（含新增 ZCode 芯片测试）、`test:ui`、`test:electron`、`lint`、`build` 全绿。

页面层：本轮应用内浏览器面板处于隐藏状态，指针操作被拦截（`take_snapshot` 仍可用），所以页面筛选没做实机点击复核，改用同一数据源的 `get_skill_activity` 核对；该组件的渲染路径在前两轮 WorkBuddy / DSH 验收里已经点过。

## 证据

- `zcode-live.json`：5 个用例的会话库原文（用户消息、`Skill` 调用与状态）、活动库记录、最终计数与其它来源计数
