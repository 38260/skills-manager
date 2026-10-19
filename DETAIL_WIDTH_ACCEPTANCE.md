# 详情页留白收敛 + 缺译本角标 验收

三条需求，都在技能详情的文档页签：

1. 「暂无中文版，当前显示原文。」这一整行不再显示。
2. 默认就是「中文版」：没有译本时正文直接展示原文，缺译改成角标提示。
3. 正文填充饱满、跟着主区变宽，不再两侧大块留白。

## 改动

| 位置 | 改动 |
| --- | --- |
| `src/lib/skillTranslation.ts` | `resolveDocumentLanguage(choice)` 只看用户选择：`"original"` 才返回原文，其余一律 `"zh-CN"`。签名去掉了 `translation` 参数——默认值不再取决于译文是否存在。 |
| `src/components/SkillTranslationReader.tsx` | ① 状态行在缺译本时**整段不渲染**；② 缺译本时「中文版」不再 `disabled`，右侧显示橙色角标（`!` + `sr-only` 文案「缺少中文版」），`title` 与 `aria-describedby` 给完整说明；③ 缺译本时编辑入口收缩为铅笔图标（文字进 `sr-only`），不再把页签行挤满。 |
| `src/components/SkillMarkdown.tsx` | `variant === "detail"` 时去掉 `max-w-[860px]`，正文跟随主区；其余场景（项目详情 / 工作区）仍保留 860px 窄栏。 |
| `src/i18n/skillTranslation.json` | 三语新增 `missingShort`（缺少中文版 / 缺少中文版 / No Chinese version）。 |

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
node output/detail-width/verify.mjs  after3      # 真实库 14/14
node output/detail-width/missing.mjs missing-v2  # 缺译本隔离库 10/10
node output/translation-switch/verify.mjs nav-v8 # 上一轮回归 30/30
npm run test                                     # 141 + 50 + 1 全通过
```

`verify.mjs`（真实库）断言：正文左右留白 ≤ 52/36px、正文宽度与主区之差 < 90px、右上角只出现「中文版 / 英文原文」、有译本时中文版默认选中、1280 宽下不溢出、深色背景亮度 26。

`missing.mjs`（隔离库，复用 `translation-coverage/seed.mjs` 的缺译技能 `en-missing-alpha`）断言：缺译本时中文版 `aria-pressed="true"` 且可点、正文无「暂无中文版」、正文直接是原文 `When to use`、角标可见且带无障碍文案、编辑入口文案为「添加中文版」且能打开空编辑器。

## 踩坑记录

- **断言函数的兜底值**：`expect(name, cond, detail)` 里写 `detail ?? "ok"` 时，`detail` 为 `false` / `""` 会被判成成功，失败项被静默吞掉。应改用 `detail === undefined` 判断。
- **把 `await` 塞进 `evaluate` 参数**：`evaluate(openDetail(name), true)` 会把 Promise 当表达式发过去，CDP 报
  `BINDINGS: string value expected`，错误信息完全指不到现场。
- **截图缩略图会骗人**：1582 宽的截图里页签和控件看起来快贴上了，实测间距 762px——判断位置一律看 `getBoundingClientRect`。
- **真实库当前 0 个缺译本**（24 个英文技能全部已译），所以缺译本行为只能用隔离库验证。
