# WorkBuddy 实测 TODO（含修复后复测）

- 开始时间：2026-10-18 10:49
- 复测完成：2026-10-18 11:52
- 客户端：WorkBuddy 5.8.3（`D:\IDE\Workbuddy\WorkBuddy.exe`）
- Skills Manager：`http://127.0.0.1:14200`（解析器版本 6）
- 活动库：`C:\Users\<user>\.skills-manager-activity\usage.db`
- 修复前基线：workbuddy 91 条（含 7 条陈旧请求）
- 清理后基线：84 条 = 手动调用 7 + 自动调用 1 + 来源未知调用 69 + 手动请求 7
- 最终计数：88 条 = 手动调用 8 + 自动调用 2 + 来源未知调用 70 + 手动请求 8

## 第一轮（修复前，已归档）

- [x] 显式选择：调用记为来源未知，另有虚假 `tool` 请求 → 失败（D1/D3）
- [x] 自动选择：调用记为来源未知 → 失败（D2）
- [x] 点名未执行：0 条记录 → 失败（D4）
- [x] 仅提及/否定：0 条记录，但 `Read SKILL.md` 未采集（D5）
- [x] 普通任务未用技能：0 条记录 → 通过
- [x] 隐式触发：调用被捕获，来源未知 → 通过
- [x] 重复扫描/刷新：计数不变 → 通过
- [x] 隔离后端重启：记录保留 → 通过
- 证据：`evidence.json`、`report.json`、`restart-report.json`

## 修复

- [x] D1 显式芯片：支持带引号 `SKILL.md` 路径与 `manually_attached_skills` 的 `name:`/`path:`
- [x] D2 自动选择：先提取 `<user_query>`，再匹配自动选择短语
- [x] D3 虚假 `tool`：剥离 system-reminder/附加技能块，自然语言只接受正向点名
- [x] D4 点名未执行：未匹配调用的点名登记为请求
- [x] V6 双反斜杠芯片路径：`skillFromPath()` 按连续分隔符切分
- [x] 回归测试：`tests/backend/activity-workbuddy.test.mjs` 9/9，通过真实消息形态夹具
- [x] 解析器版本：4 → 5 → 6
- [x] 备份并清理真实活动库 7 条陈旧请求；清理后 84 条与全量重放一致

## 复测（修复后，新会话）

- [x] 显式选择 → 手动
  - 会话：`5d8d16bc-5dfa-4ae7-8621-58393a37a9d8`
  - 原始日志：`Skill {skill:"eli5"}` 第 7 行，completed
  - 活动库：1 条 `manual/returned`，行 7，无请求
  - 结论：**通过**

- [x] 明确要求 Agent 自选 → 自动
  - 会话：`f8a7557b-8830-4518-a464-1ce76f2b8d58`
  - 用户原话：`请自动选择技能，帮我查一下今天最新的 AI 新闻，给我三条并附来源。`
  - 原始日志：`Skill {skill:"aihot"}` 第 7 行，completed
  - 活动库：1 条 `automatic/returned`，行 7，无请求
  - 结论：**通过**

- [x] 点名但未执行 → 仅请求
  - 会话：`3012d3c1-2ef0-468a-ae39-ba677f295891`
  - 用户原话：`请使用 eli5 技能来回答：什么是数据库索引？但这次只说明你会怎么用这个技能，不要实际调用任何工具或技能。`
  - 原始日志：0 个 `function_call`
  - 活动库：1 条 `request/manual/pending`，行 3
  - 使用次数：`eli5` 保持 5 次，没有增加
  - 结论：**通过**

- [x] 仅提及/否定 → 不产生记录
  - 会话：`9b2762ba-13c4-43b9-93ca-dd47c8b2a08d`
  - 用户原话：`eli5 这个技能是做什么的？只回答它的描述，不要调用任何技能。`
  - 原始日志：仅 `Read SKILL.md`，无 `Skill`
  - 活动库：0 条
  - 结论：**通过**（D5：文档加载不采集，避免把描述性读取计成使用）

- [x] 普通任务隐式触发 → 捕获但保留未知
  - 会话：`9d641f09-7b76-4fad-8855-4c8216b8eb65`
  - 用户原话：`给五岁小孩解释一下什么是量子纠缠，三句话以内。`
  - 原始日志：`Skill {skill:"eli5"}` 第 7 行，completed
  - 活动库：1 条 `unknown/returned`，行 7
  - 结论：**通过**（隐式捕获与自动判定分开）

- [x] 重复扫描不膨胀
  - 连续两次 `scan_skill_activity`：88 → 88，重复 ID 0
  - 结论：**通过**

- [x] 页面刷新不膨胀
  - WorkBuddy 筛选：88 / 80 / 0 / 8；手动 8、自动 2、未知 70
  - 结论：**通过**

- [x] 真实后端重启持久化
  - 应用自身 `restart_app`：PID 46684 → 42504
  - 重启后扫描：88 条，分类与四个复测会话均保留
  - 结论：**通过**

- [x] 全量日志重放对账
  - 500 个文件，0 解析错误；expected 88 = actual 88；stale/missing 均为空
  - 结论：**通过**

- [x] 成功/失败/待确认状态
  - 复测调用全部“已返回”；点名未执行显示“等待结果”；无失败调用
  - 结论：**通过**

## 回归与交付

- [x] `node --test tests/backend/activity-workbuddy.test.mjs`：9/9
- [x] `npm run test:backend` / `test:ui` / `test:electron`
- [x] `npm run lint` / `npm run build`
- [x] 报告与证据更新：`REPORT.md`、`retest-live.json`、`api-after-live.json`、`usage-after-live.json`、`analysis-final.txt`
- [ ] 提交修复代码与验收文档（分开提交，不包含用户 WIP）

## 未执行

- WorkBuddy AI 与其他客户端未测试（本轮只按要求测试 WorkBuddy）
- D5 文档加载采集未实现（明确的范围决定：`Skill` 调用是 WorkBuddy 的技能执行信号，避免同一会话重复计数）
