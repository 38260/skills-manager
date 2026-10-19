# 详情页留白收敛 + 缺译本角标 验收

四条需求，都在技能详情的文档页签：

1. 「暂无中文版，当前显示原文。」这一整行不再显示。
2. 默认就是「中文版」：没有译本时正文直接展示原文，缺译改成角标提示。
3. 正文填充饱满、跟着主区变宽，不再两侧大块留白。
4. **目录跟着正文走**：默认选中「中文版」时，目录必须是中文；只有技能本身没有中文译本（正文回落成英文原文）时目录才应该是英文，且目录不能整块消失。按钮文案「英文原文」三语统一改为 `English`。

## 改动

| 位置 | 改动 |
| --- | --- |
| `src/lib/skillTranslation.ts` | `resolveDocumentLanguage(choice)` 只看用户选择：`"original"` 才返回原文，其余一律 `"zh-CN"`。签名去掉了 `translation` 参数——默认值不再取决于译文是否存在。 |
| `src/components/SkillDetailPanel.tsx` | 目录数据源 `readingContent` 与阅读器取内容的口径对齐：`documentLanguage === "zh-CN" && translation?.content ? 译文 : activeDoc?.content`。之前写成 `translation?.content`（译文为空时得到 `undefined`）→ `headings = []`，**缺译本/中文原文技能的目录会整块消失**。 |
| `src/components/SkillTranslationReader.tsx` | ① 状态行在缺译本时**整段不渲染**；② 缺译本时「中文版」不再 `disabled`，右侧显示橙色角标（`!` + `sr-only` 文案「缺少中文版」），`title` 与 `aria-describedby` 给完整说明；③ 缺译本时编辑入口收缩为铅笔图标（文字进 `sr-only`），不再把页签行挤满。 |
| `src/components/SkillMarkdown.tsx` | `variant === "detail"` 时去掉 `max-w-[860px]`，正文跟随主区；其余场景（项目详情 / 工作区）仍保留 860px 窄栏。 |
| `src/lib/skillMarkdownText.ts` | 新增 `stripInlineMarkdown`：剥掉标题里的强调、行内代码、链接、图片、转义与行内 HTML。`extractHeadings` 与 `headingMatchesTitle` 都走它，目录条目不再出现 `*going*`、`` `code` `` 这类裸标记。 |
| `src/i18n/skillTranslation.json` | 三语新增 `missingShort`（缺少中文版 / 缺少中文版 / No Chinese version）；按钮 `original` 三语统一改为 `English`（原为「英文原文」/「英文原文」/`English original`）。 |

## 实测数据（真实库，技能 apple-design）

| 项 | 改前 | 改后 |
| --- | --- | --- |
| 主区宽度 | 1021px | 1021px |
| 正文宽度 | 860px | **941px** |
| 左侧空隙 | 89px | **48px**（= 主区 `pl-12`） |
| 右侧空隙 | 73px | **32px**（= 主区 `pr-8`） |
| 页签尾 → 控件左 | — | 762px（控件贴行尾，不与页签重叠） |

1280 宽窗口下正文 639px，两侧同样只留 48 / 32px，无横向滚动。

## 验收

```
node output/detail-width/verify.mjs  toc-v3       # 真实库 30/30
node output/detail-width/missing.mjs missing-v2   # 缺译本隔离库 14/14
node output/translation-switch/verify.mjs nav-v9  # 上一轮回归 30/30
npm run test                                      # 全通过
```

`verify.mjs`（真实库）断言：正文左右留白 ≤ 52/36px、正文宽度与主区之差 < 90px、右上角只出现「中文版 / English」、有译本时中文版默认选中且目录与正文标题一一对应、切到 `English` 与切回中文版后目录都跟着换且不消失、中文原文技能（`aihot`，无译本）目录非空且与正文一致、1280 宽下不溢出、深色背景亮度 26。

`missing.mjs`（隔离库，复用 `translation-coverage/seed.mjs` 的缺译技能 `en-missing-alpha`）断言：缺译本时中文版 `aria-pressed="true"` 且可点、正文无「暂无中文版」、正文直接是原文 `When to use`、角标可见且带无障碍文案、编辑入口文案为「添加中文版」且能打开空编辑器，并新增**缺译本 / 切到 English 后目录都与正文同源**。

## 目录与正文同源：实测

| 技能 | 状态 | 目录条数 | 正文标题数 | 目录样例 | 与正文一致 |
| --- | --- | --- | --- | --- | --- |
| `apple-design` | 有中文译本，默认中文版 | 19 | 19 | 核心理念 / 1. 响应 —— 消灭延迟 | ✅ |
| `apple-design` | 点 `English` | 19 | 19 | The Core Idea / 1. Response — kill latency | ✅（修 `stripInlineMarkdown` 前 `*going*` 对不上） |
| `aihot` | 中文原文、无译本 | 5 | 5 | AI HOT / 安全边界 / 核心工作流 | ✅（修复前目录为 0 条） |
| `en-missing-alpha` | 英文、无译本（隔离库） | 2 | 2 | When to use / Steps | ✅（修复前目录为 0 条） |

结论：**目录永远等于正文当前展示的那份内容**。修复前的问题是"回落缺失导致目录整块消失"，不是"目录被强制留在英文"——只要技能本身没有中文译本，正文和目录都只能是英文，这与「中文版」按钮的回落行为一致。

## 踩坑记录

- **断言函数的兜底值**：`expect(name, cond, detail)` 里写 `detail ?? "ok"` 时，`detail` 为 `false` / `""` 会被判成成功，失败项被静默吞掉。应改用 `detail === undefined` 判断。
- **把 `await` 塞进 `evaluate` 参数**：`evaluate(openDetail(name), true)` 会把 Promise 当表达式发过去，CDP 报
  `BINDINGS: string value expected`，错误信息完全指不到现场。
- **截图缩略图会骗人**：1582 宽的截图里页签和控件看起来快贴上了，实测间距 762px——判断位置一律看 `getBoundingClientRect`。
- **真实库当前 0 个缺译本**（24 个英文技能全部已译），所以缺译本行为只能用隔离库验证。
- **角标会混进按钮的 `textContent`**：缺译本时「中文版」按钮读出来是 `中文版!缺少中文版`，按 `text === "中文版"` 找会找不到。探针里额外取 `firstChild.nodeType === 3` 的文本作为 `label`，断言一律用 `label`。
- **目录不在 `aside` 直下**：`aside` 里还有侧栏分节（`目录 / 项目结构 / 项目来源`），真正装目录项的是 `aside nav[aria-label]`。
- **目录条目要剥行内 Markdown**：正角标渲染时 `*going*` 的星号会被吃掉，目录取原始行却保留星号，两边对不上。共用 `stripInlineMarkdown` 后一致。
