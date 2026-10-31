# 为什么有的调用记录没有「技能超链接」

## 一句话
超链接不是装饰，而是「这条记录能唯一定位到技能库里的某个技能」的结果；定位不到就退化成纯文本，避免跳到错的技能上。

## 判定链路（`backend/activity/service.mjs`）
1. **严格匹配 `managedSkillId`**：记录的 `skillPath`（去掉 `/SKILL.md`）必须与某个技能的中央库路径 `central_path` 或它的某条部署路径 `skill_targets.target_path` **完全相等**。
2. **名称兜底 `usageSkillId`**：严格匹配失败时，若「技能名 / 别名 / 目录名」在技能库里**只命中 1 个**技能，也算关联（UI 标注「按技能名匹配」）。
3. 两条都没命中 → `null` → 列表里是纯文本（hover 提示「未关联技能库」），详情里显示「未关联技能库；原始调用记录仍然保留。」

前端据此渲染：`ActivityTable` 第 79 行 `const skillId = record.managedSkillId ?? record.usageSkillId ?? null`；`ActivityDetailPanel` 同理。

## 本机真实数据（271 条，只读诊断 `output/link-diagnosis/analyze.mjs`）
| 类别 | 条数 |
| --- | --- |
| 严格路径关联 | 46 |
| 仅按名称关联（带「按技能名匹配」标注） | 89 |
| **无链接** | **136** |

无链接的 136 条构成：
| 原因 | 条数 | 说明 |
| --- | --- | --- |
| 该技能不在 Skills Manager 技能库里 | 135 | 日志里的技能属于宿主侧插件/内置技能，例如 `C:/Users/luckyzyb/.codex/plugins/cache/ponytail/.../skills/ponytail/SKILL.md`、`C:/Users/luckyzyb/.codex/skills/.system/imagegen/SKILL.md`、WorkBuddy 插件缓存里的 `ardot-design-core`、`browser-use:control-browser` |
| 技能库里有 2 个同名技能，无法唯一定位 | 1 | 名称兜底主动放弃，不猜 |

典型无链接技能（记录数 / 库里同名数）：`ponytail` 36/0、`computer-use` 11/0、`local-web-ui-headless-verify` 7/0、`imagegen` 6/0、`browser-use:control-browser` 6/0、`ardot-design-core` 6/0、`git-remote-sync-github` 6/0、`ponytail-audit` 4/0。

另外：271 条里有 **149 条日志本身没有 `skillPath`**（只有技能名），这些只能走名称兜底——名字在库里唯一就连上（89 条里大多数属于这种情况），否则断开。

## 结论
主要是「技能没被纳管」而不是「匹配代码有 bug」：`ponytail`、`computer-use`、`imagegen`、`ardot-*`、`browser-use:*` 这些是 Codex / WorkBuddy / ZCode 各自的插件缓存或系统内置技能，从来没进过 `~/.skills-manager/skills`，所以既没有中央库路径，也没有部署目标路径，名称也查不到。

## 可选改进（按性价比）
1. **把「未纳管」说清楚 + 一键纳管**：无链接时在详情里显示「该技能未纳管」并给「从该路径导入到技能库」按钮，纳管后自动有链接（根治，改动最大）。
2. **无链接时的可见提示**：列表里技能名旁加一个淡色「未纳管」角标，hover/详情说明原因，用户不用猜（改动小，纯前端）。
3. **同名歧义跳筛选**：那 1 条同名记录改为跳到技能库并预填搜索词（改动小）。
4. 放宽匹配（按插件缓存目录前缀匹配）——**不建议**，会引入错链。
