# 详情页留白收敛 + 缺译不占视觉 验收

五条需求，都在技能详情的文档页签：

1. 「暂无中文版，当前显示原文。」这一整行不再显示。
2. 默认就是「中文版」：没有译本时正文直接展示原文。
3. 正文填充饱满、跟着主区变宽，不再两侧大块留白。
4. **目录跟着正文走**：默认选中「中文版」时，目录必须是中文；只有技能本身没有中文译本（正文回落成英文原文）时目录才应该是英文，且目录不能整块消失。按钮文案「英文原文」三语统一改为 `English`。
5. **界面上不再有任何缺译角标**（感叹号）。缺译说明只留 `title` + `sr-only`；而且只有正文本身是英文的技能才算缺译，**中文原文的技能一句话提示都不给**。

## 改动

| 位置 | 改动 |
| --- | --- |
| `src/lib/skillTranslation.ts` | ① `resolveDocumentLanguage(choice)` 只看用户选择：`"original"` 才返回原文，其余一律 `"zh-CN"`；② 新增 `documentSourceLanguage(content)`，与后端 `backend/skill-translations.mjs` 的 `documentLanguage` 同口径（阈值 0.2，两个实现由单测交叉校验）。 |
| `src/components/SkillDetailPanel.tsx` | 目录数据源 `readingContent` 与阅读器取内容的口径对齐：`documentLanguage === "zh-CN" && translation?.content ? 译文 : activeDoc?.content`。之前写成 `translation?.content`（译文为空时得到 `undefined`）→ `headings = []`，**缺译本/中文原文技能的目录会整块消失**。另把 `original={activeDoc.content}` 传给语言控件用于缺译判定。 |
| `src/components/SkillTranslationReader.tsx` | ① 状态行在缺译本时**整段不渲染**；② 「中文版」不再 `disabled`；③ **删掉橙色感叹号角标**，缺译说明改为不可见的 `sr-only`（+ `title` / `aria-describedby`）；④ 缺译判定收窄为 `!译文 && documentSourceLanguage(original) === "en"`，中文原文技能不生成任何提示；⑤ 编辑入口文案按「有没有译本」在「添加中文版 / 更新中文版」之间切换，恢复为可见文字（不再是纯图标）。 |
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
node output/detail-width/verify.mjs  nobadge-v1    # 真实库 32/32
node output/detail-width/missing.mjs nobadge-v1    # 缺译本隔离库 19/19
node output/translation-switch/verify.mjs nav-v10  # 上一轮回归 30/30
npm run test                                       # 全通过
```

`verify.mjs`（真实库）断言：正文左右留白 ≤ 52/36px、正文宽度与主区之差 < 90px、右上角只出现「中文版 / English」、有译本时中文版默认选中且目录与正文标题一一对应、切到 `English` 与切回中文版后目录都跟着换且不消失、中文原文技能（`aihot`）目录非空且与正文一致、**控件区内 `amber` 元素为 0、没有任何 `aria-hidden` 的 `!`、中文原文技能连 `sr-only` 说明都没有**、1280 宽下不溢出、深色背景亮度 26。

`missing.mjs`（隔离库，复用 `translation-coverage/seed.mjs`）断言：英文缺译技能 `en-missing-alpha` 中文版 `aria-pressed="true"` 且可点、正文无「暂无中文版」、正文直接是原文 `When to use`、**无可见角标但 `sr-only` 说明仍在**、编辑入口文案「添加中文版」且能打开空编辑器；新增中文原文技能 `zh-native` 无角标、无缺译说明、目录仍与正文同源；缺译本 / 切到 English 后目录都与正文同源。

## 去掉缺译角标：实测

| 技能 | 正文语言 | 有译本 | 界面角标 | 缺译说明（sr-only） | 编辑入口 |
| --- | --- | --- | --- | --- | --- |
| `apple-design` | 英文 | ✅ | 无 | 无 | 更新中文版 |
| `aihot` | **中文** | ❌ | **无** | **无**（判定前：有 `!` 角标 + 「缺少中文版」） | 添加中文版 |
| `zh-native`（隔离） | **中文** | ❌ | **无** | **无** | 添加中文版 |
| `en-missing-alpha`（隔离） | 英文 | ❌ | **无**（判定前：有 `!` 角标） | 有（`缺少中文版`） | 添加中文版 |

**为什么中文原文技能以前也会冒角标**：旧判定是"没有译文 = 缺译"，与正文语言无关。真实库 24 个英文技能已全部译完，于是唯一还会显示角标的就剩 32 个**中文原文**技能——给一份中文文档打上「缺少中文版」，纯属误导。现在判定与工作台覆盖率统计取同一个口径：分母只算英文原文。

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
- **不可见文本也会混进 `textContent`**：`sr-only` 的「缺少中文版」虽然在屏幕上看不见，`button.textContent` 仍会读到 `中文版缺少中文版`。探针里额外取 `firstChild.nodeType === 3` 的文本作为 `label`，断言一律用 `label`；判断"界面上有没有角标"要看 `aria-hidden` 的 `!` 或 `[class*="amber"]`，不能只看文案。
- **目录不在 `aside` 直下**：`aside` 里还有侧栏分节（`目录 / 项目结构 / 项目来源`），真正装目录项的是 `aside nav[aria-label]`。
- **目录条目要剥行内 Markdown**：正角标渲染时 `*going*` 的星号会被吃掉，目录取原始行却保留星号，两边对不上。共用 `stripInlineMarkdown` 后一致。
