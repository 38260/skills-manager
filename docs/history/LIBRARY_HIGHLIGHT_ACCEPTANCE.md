# 技能库搜索结果高亮

需求：技能库里搜索时，命中结果里的关键词要有高亮。

## 改动
- 新增 `src/lib/highlight.ts`：`splitHighlight(text, query)` 把文本按搜索词切成命中/未命中片段（大小写不敏感、保留原文大小写、多次命中全切、空词或未命中返回 null）。
- 新增 `src/components/HighlightText.tsx`：把命中片段包进 `<mark>`，样式用语义 token（`bg-accent-bg` + `text-accent-dark dark:text-accent-light`），不是浏览器默认黄。
- `src/views/MySkills.tsx`：网格与列表两种视图的技能名（h3）、卡片里的「别名: 原名」、描述（p）都改用 `<HighlightText query={search} />`。

覆盖字段与搜索口径一致（`matchSkillSearch`：别名/名称/目录名/自定义描述/描述），搜索词带首尾空格按 trim 后匹配；React 文本自动转义，搜索词带 `<` `>` 也不会注入。

## 验证
- 单测 `tests/ui/highlight-render.test.mjs`（5 项）：切分规则、mark 渲染、无搜索不产生 mark、尖括号转义；UI 套件 43/43。
- 浏览器验收 `node output/library-highlight/verify.mjs final`：**17/17 通过**，证据 `output/library-highlight/evidence/final/`（5 张截图）。
  覆盖：无搜索无高亮、命中名称（gamma）、命中描述（清单）、命中别名原名（review）、大写搜索 GAMMA 保留原文大小写、网格/列表两视图、高亮底色实测 `rgba(5,150,105,0.09)`（accent，非默认黄）。
- 数据：复用 `output/column-widths/seed.mjs`（12 技能），另用 `seed-extra.mjs` 补描述与别名（installLocal 不写 description，不补就验不了描述高亮）。

## 第二轮：命中来源标签 + 命中片段前置
用户实测：搜「git」出现 `report-driven-batch-fix` / `find-skills`，看似搜错了。只读诊断（`why-git.mjs`）确认两者命中在**描述深处**（第 112/136 字的「GitHub」「一次 git」），高亮被截断看不见。据此：
- `src/lib/skillSearch.ts`：`SkillSearchMatch` 增加 `index`（命中位置），新增 `matchSnippet(match, query, before=24, after=56)` 截命中处前后的文字（带省略号）。
- `src/views/MySkills.tsx`：
  - 命中**不在展示名里**时，描述前加小标签「{{field}}命中」（字段：别名/名称/目录名/自定义说明/描述），hover 显示「搜索词没有出现在技能名里，命中位置：{{snippet}}」；
  - 描述类命中把描述展示文本替换为命中处前后的片段，高亮必在可见范围内；
  - 名字命中不加标签（高亮本身可见）。
- 三语言新增 `mySkills.searchMatch.*`（chip + 5 字段名 + hint）。

验证：`node output/library-highlight/verify.mjs final3` **31/31 通过**（新增：深层命中出「描述命中」标签、hover 带上下文、长描述截成片段且以省略号开头、名字命中无标签、列表视图同效、自定义说明命中单独标注）；UI 套件 43/43；tsc/ESLint/build 全绿。截图 `evidence/final3/`（8 张）。
