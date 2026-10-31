# 语言切换控件归位与「切换不动位置」验收

改动两块，都在技能详情的文档页签：

1. `中文版 / English（原「英文原文」） / 重新读取 / 更新中文版` 从正文顶部移到**页签行最右侧**，与 `文档 / 来源与差异 / 调用记录` 同一行、贴靠行尾；正文区只剩内容。
2. **切换语言不改变阅读位置**：不回到顶部、不清空当前小节高亮。

## 实现要点

| 位置 | 改动 |
| --- | --- |
| `src/components/SkillTranslationReader.tsx` | 拆出 `SkillTranslationControls`（切换 + 重新读取 + 编辑入口，`role="group"` 带 `aria-pressed`）；`SkillTranslationReader` 只渲染正文与编辑器。页签行按钮通过 `TRANSLATION_EDITOR_EVENT` 通知面板开编辑器。 |
| `src/components/SkillDetailPanel.tsx` | 页签行外层改成 `flex ... justify-between`，左 `nav`、右 `SkillTranslationControls`；`chooseDocumentLanguage` 只 `setLanguageChoice`，不再 `scrollTo`、不再清 `activeHeading`；非文档页签时 `disabled`。 |
| `src/components/SkillTranslationReader.tsx`（编辑器） | 编辑器仍渲染在正文顶部，打开时面板 `scrollTo({ top: 0 })`——这是**主动**动作，只发生在点“更新中文版”时。 |

## 验收脚本

`output/translation-switch/verify.mjs`：隔离数据（`output/translation-coverage/seed.mjs`）+ 真实 `backend/server.mjs` + 无头 Chrome（CDP）。

```
node output/translation-switch/verify.mjs <tag>
```

证据落 `output/translation-switch/evidence/<tag>/`：`report.json` + 5 张 png。

**最近一次（按钮文案改为 `English` 后重跑）：`nav-v9`，30/30 通过。**

| # | 断言 | 实测 |
| --- | --- | --- |
| 1 | 控件整组贴在页签行行尾 | `ctrl.right = 1486`，与外壳右内边距齐平；`nav.right = 511` |
| 2 | 控件与页签同一行 | `nav.y = ctrl.y = 154` |
| 3 | 行内含「中文版 / English / 更新中文版」 | 4 个按钮：中文版、English、重读（无文字，`aria-label`）、更新中文版 |
| 4 | 正文区没有语言切换按钮 | `.skill-detail-main [aria-pressed]` = 0 |
| 5 | 正文区没有编辑按钮 | 含「中文版」的按钮 = 0 |
| 6 | 切到 English 正文真的换 | 正文出现 `When to use` |
| 7 | 切回中文版正文真的换 | 正文出现 `何时使用` |
| 8 | **切到 English 不动滚动位置** | `900 → 900` |
| 9 | **切回中文版不动滚动位置** | `900 → 900` |
| 10 | 滚动位置确实不在顶部（断言有效） | 900 |
| 11 | 选中态正确 | 英文 `aria-pressed=false`、中文 `true` |
| 12 | 行尾按钮能开编辑器 | 编辑器出现，`textarea.value` 以 `# en-done` 开头 |
| 13 | 取消后编辑器关闭 | ok |
| 14 | 非文档页签时编辑/重读禁用 | 调用记录页签下：重读 `disabled`、更新中文版 `disabled`；语言切换保持可用 |
| 15 | 浅色/深色主题真的生效 | 浅色 `html` 无 `dark`；深色加上 `dark` |
| 16 | 深色正文配色 | 背景 `rgb(23,26,35)`（亮度 26）、文字 `rgb(243,245,249)`（亮度 245） |
| 17 | 900px 窄窗不溢出 | `scrollWidth = innerWidth = 900`，控件可见、与页签同行 |

## 两个踩过的坑（脚本层，非产品缺陷）

1. **打开详情**：首页卡片可能还没渲染。脚本改为先 `Page.navigate` 到 `/my-skills`，轮询 `.app-panel` 出现 `en-done` 再 `scrollIntoView + click`，并给后续表达式加 `if (!nav || !ctrl) return { missing: true }` 之类的空值保护——否则详情没打开时会抛 `Uncaught`，看不出真正原因。
2. **滚动断言的前提是两侧都够长**。最初的夹具里英文原文只有 6 行（`scrollHeight 742 = clientHeight`，根本不可滚），切过去 `scrollTop` 被浏览器合法夹到 0，看起来像「被重置」。产品行为本来就是对的。现在夹具把英文原文也写成 14 节长文，两侧高度接近，`900 → 900` 才有意义。

   判据：切换前后都量 `scrollHeight - clientHeight > 0`；若一侧不可滚，`scrollTop` 归零是浏览器行为，不能算回归。

## 主题验证的坑

`useTheme` 挂载时会用 `get_settings("theme")` **覆盖** localStorage。只写 `localStorage.theme` 不生效（截图仍是浅色）。脚本必须先 `invoke("set_settings", { key: "theme", value: "dark" })` 再导航。另外 `Read` 图片工具对这两张 png 会误报「内容相同」，实际 md5 不同；关键结论用像素采样（canvas `getImageData`）确认：浅色 `[255,255,255]`，深色 `[23,26,35]`。
