# 工作台 · 中文译本覆盖验收

交付日期：2026-10-19。验证对象为当前工作区源码、Vite 构建和隔离演示库。

## 行为

- 工作台统计区从 3 张卡扩到 4 张，新增「中文译本」：大字是**还有多少个英文技能的正文没有中文版**，进度条与百分比是 `已译 / 英文原文`。
- 前三张卡（技能总量、部署覆盖、已启用 Agent）顺序不变，新卡排在最后，不挪动既有位置。
- **分母只算正文是英文的技能**。中文原文的技能本来就不需要译本，不能算成待办——本机实测 56 个技能里 32 个是中文原文，若把它们算进去会显示成 32 个假待办。
- 语言判定：去掉 frontmatter、代码块与行内代码后，比较中文字符与拉丁字母数量，中文占比 < 20% 判为英文原文。本机 56 个技能实测呈明显双峰（英文 ≤ 0.016，中文 ≥ 0.617），阈值落在空档里。
- 缺译时为可展开入口：点一下列出是哪些技能（优先显示别名），点行打开该技能的全局详情，在原页面就能粘贴中文版。
- 原文改动过、译文还对应旧版本的技能**不算缺译**，单独一行提示「N 个译文对应旧原文，待复核」，琥珀色。
- 全部译完时不再保留展开入口，改为 `✓ N 个英文技能都有中文版`；没有英文技能时显示「暂无英文原文的技能」。
- 还没读到统计结果时显示 `—` 而不是 `0`，避免把「没读到」显示成「做完了」；接口失败显示「译文统计读取失败」并保留重试机会（技能列表一变化就会重新统计）。
- 在详情里保存译文后，卡片数字会跟着变（保存译文是 mutating 命令，会广播技能变更并触发重算），不需要手动刷新页面。
- 中文 / 繁体 / 英文三套文案齐备；颜色只用既有语义 token（`bg-accent-light`、`emerald-600`、`amber-600`、`text-danger`）。

## 后端口径

新增只读命令 `get_translation_coverage`（不带 `mutating`，浏览器与桌面两种外壳都能直接调）：

```json
{ "total": 56, "english": 24, "chinese": 32, "unknown": 0,
  "translated": 24, "missing": 0, "stale": 0,
  "missing_skills": [], "stale_skills": [] }
```

- 逐个技能读一次 `SKILL.md`（本机 56 个、最大 85 KB，实测整轮 38 ms），不额外缓存，避免读到旧内容。
- 译文文件损坏（非法 JSON / 字段缺失）按**缺译**处理，不会让整次统计失败；这与详情页「读取失败不当成无译文」不同，详情页需要提示用户修文件，统计页只需要一个可行动的数字。
- 语言判定与译文校验规则都从既有实现里抽出复用（`documentLanguage` / `validSaved`），没有第二套口径。

## 整体测试

| 检查 | 结果 |
| --- | --- |
| 后端测试 | 141/141 通过（新增 4 项译本统计用例） |
| UI 测试 | 50/50 通过（新增 6 项统计卡渲染用例） |
| Electron 桥接测试 | 1/1 通过 |
| TypeScript + Vite 构建 | 通过 |
| ESLint（全项目） | 通过 |
| Chrome 隔离实测 | 38/38 通过 |

浏览器实测包含：4 张卡顺序、大字取缺译数而非英文技能数、进度 25%、待复核提示、展开名单（别名与超长名）、中文原文技能不入名单、面板贴按钮且未被裁切、Esc 收起、外点收起、行点击进详情且缺译技能的中文版入口不可用、补一个译本后 25%→50% 与 2→1、英文界面、深色主题、960 窄窗口两列且无横向溢出。未访问真实技能库。

结构化结果见 [report.json](output/translation-coverage/evidence/card-v2/report.json)。

## 真实库现状（只读测量，未改动）

- 56 个技能：英文原文 24 个、中文原文 32 个，与 `TRANSLATION_BATCH_TODO.md` 的人工分类完全一致。
- 24 个英文技能全部已有中文译本，且没有过期译文 → 卡片当前显示 **0 个待译、100%**。
- 测量脚本 `output/translation-coverage/measure.mjs`、`probe-language.mjs` 只读打开真实库，不写任何文件。

## 截图

- [收起态（4 张卡）](output/translation-coverage/evidence/card-v2/01_collapsed_light.png)
- [展开待译名单](output/translation-coverage/evidence/card-v2/02_expanded_light.png)
- [点击名单进详情](output/translation-coverage/evidence/card-v2/03_detail_missing_translation.png)
- [英文界面](output/translation-coverage/evidence/card-v2/04_english_light.png)
- [深色主题](output/translation-coverage/evidence/card-v2/05_collapsed_dark.png)
- [960 窄窗口](output/translation-coverage/evidence/card-v2/06_narrow_dark.png)

## 复现

```powershell
npm run build
node output/translation-coverage/verify.mjs card-v3
```

`verify.mjs` 每轮新建 `output/translation-coverage/data/run-<tag>-<时间戳>`，不删除旧目录（本机 `rmSync` 会走回收站并失败）；证据落 `evidence/<tag>/`。
