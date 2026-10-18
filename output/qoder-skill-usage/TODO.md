# Qoder 技能调用统计实测

日期：2026-10-18。只用已有 Qoder 工作区和已安装技能做只读审查，不修改被审查源码。每个阶段完成后记录证据并独立提交；原有未提交修改不纳入提交。

## 基线

- Qoder 日志来源已启用；测试前定向扫描 66 个文件，解析错误 0，状态 `ready`。
- 测试前数据库中 Qoder 记录 5 条，`web-design-guidelines` 记录 0 条。
- 测试技能：Qoder 已安装的 `web-design-guidelines`；目标文件为 `src/views/SkillActivity.tsx`。
- 判定以会话日志中的 `Skill` 工具事件、扫描后的数据库记录及界面数字交叉核对；Agent 自述不单独作为调用证据。

## 任务

| 阶段 | 验收点 | 状态 |
| --- | --- | --- |
| Q1 | 显式要求使用技能，核对真实工具调用、`manual`、记录类型和计数 | 通过 |
| Q2 | 不点名技能的审查请求，核对隐式选择和实际分类 | 未触发技能；误报检查通过 |
| Q3 | 明确要求自行选择技能，核对 `automatic` 分类 | 待测 |
| Q4 | 点名但未执行、普通提及与重复扫描，核对误报和去重 | 待测 |
| Q5 | 运行相关测试与整体回归，汇总通过、失败、未执行项 | 待测 |

## 统计口径

- `request` 表示用户请求但尚无调用证据；技能库使用次数应只累加非 `request` 记录。
- `manual` 需要明确点名证据；`automatic` 需要明确自主选择指令；仅观察到调用而没有触发证据时应为 `unknown`。
- 同一条工具调用重扫后 ID 和计数必须稳定。历史记录与本轮记录按会话和时间区分。

## Q1 显式调用结果

- 在现有 Qoder SkillManager 会话中明确要求使用 `web-design-guidelines`，对 `src/views/SkillActivity.tsx` 做只读审查；Qoder 界面显示任务成功，并给出 3 条审查发现。
- 原始日志包含一次 `Skill` 工具调用，参数 `skill=web-design-guidelines`，随后有对应工具结果；不能仅凭答复文本判定调用。
- 定向扫描 Qoder 的 66 个日志文件，重新解析 1 个，错误 0。数据库新增 1 条 `invocation / manual / returned`，证据为 `user_selection`；同名 Qoder 记录在测试前为 0。
- 当前服务接口 `get_skill_activity` 的 Qoder + 技能筛选返回 1 条；该条没有可验证技能路径，严格归属为空，按唯一技能名匹配到库中技能。`get_skill_usage` 显示该技能总使用次数 2：Qoder 调用 1 条，另有 Codex 读取技能文档 1 条。总次数是跨 Agent 口径，不能直接视为 Qoder 调用数。

## Q2 不点名审查结果

- 分别用中文「Web 界面可访问性审查」和英文技能描述中的「Review my UI and check accessibility」请求审查两个未修改的组件。
- 两轮 Qoder 都完成审查，但原始日志只有普通 `Read` / `Bash` 工具，没有 `Skill` 工具调用。因此本轮没有可供验证的隐式技能使用，不能把审查答复算成调用成功。
- 扫描后 Qoder 的 `web-design-guidelines` 记录仍为 Q1 的 1 条 `manual` 调用，无新增记录；未调用不误计数这一项通过。
