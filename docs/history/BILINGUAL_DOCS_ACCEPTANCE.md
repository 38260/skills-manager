# 中英文文档切换验收

## 已完成

- 技能库详情的“文档”区新增“中文版 / 英文原文”切换，有中文时默认中文，缺失时直接展示已有原文。
- 切换语言同时更换正文和右侧目录，包括标题、数量和定位锚点；窄屏抽屉使用同一份目录。
- 支持粘贴完整 Markdown 译文；保存后立即展示中文，重开详情、刷新页面和服务重启后可读取。
- 原文更新保留旧译文并提示核对；读取失败可以重试；保存失败或并发冲突保留输入并拒绝覆盖其他窗口的内容。
- 译文单独存放，不修改技能目录的 `SKILL.md`，不参与 Agent 部署。

交互规则、存储位置和交给其他 AI 的接口步骤见 [翻译交接说明](TRANSLATION_HANDOFF.md)；分项进度见 [TODO](BILINGUAL_DOCS_TODO.md)。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 完整后端测试 | 137/137 通过 |
| 完整前端测试 | 44/44 通过 |
| Electron 桥接测试 | 1/1 通过 |
| 全项目 ESLint | 通过 |
| TypeScript + Vite 生产构建 | 通过 |
| 真实 Chrome 交互 | 17/17 通过，未捕获运行异常 0 |
| 真实 HTTP + 服务重启 | 译文持久保存、版本冲突拒绝、原文件保持不变 |
| 英文原文件指纹 | 两份隔离技能均保持不变 |
| 用户已有工作区内容 | 210 个文件核对无额外修改；两个共用文件只暂存本轮增量 |

沙箱首次运行有两项 Git 取消测试因 Windows 拒绝终止测试子进程而失败；常规权限下重新运行完整测试得到上表结果。测试与断言没有修改。

机器可读证据：[results.json](output/bilingual-docs/results.json)、[工作区保护核对](output/bilingual-docs/workspace-preservation.json)。全部页面和保存操作使用隔离演示技能库，不读取或翻译真实技能。

## 实际界面

- [浅色中文版与中文目录](output/playwright/bilingual-chinese-light.png)
- [浅色英文原文与英文目录](output/playwright/bilingual-english-light.png)
- [深色中文版](output/playwright/bilingual-chinese.png)
- [深色英文原文](output/playwright/bilingual-english.png)
- [缺少中文版时默认原文](output/playwright/bilingual-missing.png)
- [窄窗口中文目录抽屉](output/playwright/bilingual-narrow.png)

## 人工验收步骤

1. 重启当前源码应用/本地服务以载入新增接口；本轮已生成新的 `dist/`。
2. 打开任意尚未添加译文的技能，确认直接显示原文，“英文原文”为选中态，“中文版”不可选。
3. 点“添加中文版”，粘贴其他 AI 翻译好的 Markdown，保存后确认自动展示中文且右侧目录改成中文。
4. 点中文目录中的一个标题，确认能定位正文；切到“英文原文”，确认正文和目录同时回到英文，再验证一个英文目录定位。
5. 关闭详情重新打开，确认默认中文；刷新页面后再次确认译文存在。
6. 在窄窗口打开“信息栏”，确认目录跟随当前正文语言。

如果要复用隔离演示，在仓库根目录执行 `node output/bilingual-docs/seed.mjs` 生成本轮专属演示数据，再执行：

```powershell
node backend/server.mjs --port 14378 --directory output/bilingual-docs/data/app --home output/bilingual-docs/data/home
```

浏览器打开 `http://127.0.0.1:14378/my-skills`。`bilingual-demo` 有演示译文，`english-only` 初始没有译文。浏览器验收脚本为 `output/bilingual-docs/verify-browser.js`，适用于已打开的 `bilingual-demo` 详情和刚生成的演示数据。

## 交付边界

- 翻译任务交给用户指定的其他 AI，本轮只使用虚构的演示译文。
- 本次作用于中央技能库详情阅读；全局/项目工作区中的独立原文件预览仍展示其实际内容。
- 没有重新打包 Windows EXE，也没有进行真实 Agent 客户端验收。
- 保留验收脚本、结构化结果与六张截图。隔离服务、演示数据、临时基线副本和下载缓存已清理。
- 用户原有未提交修改已保留，不覆盖、不重置、不混入本次提交。

## 分项提交

- `488a5c7`：独立译文保存与版本保护。
- `f41e97d`：中英文切换、目录同步与翻译交接文档。
- 最终提交：整体验收、回归测试、截图和交付文档。
