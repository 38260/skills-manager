# 技能详情侧栏与 Agent 摘要验收

交付日期：2026-10-19。验证对象为当前工作区源码、Vite 构建和隔离演示库。

## 行为

- 详情右栏改为“目录 / 项目结构 / 项目来源”页签，一次显示一组内容。目录有更多显示空间，部署开关和关联项目仍保留在辅助栏。
- 切换辅助页签保留正文阅读位置；支持方向键、Home、End。目录仍能定位正文并同步高亮当前章节。
- 主区不在文档时禁用目录，展示有效辅助内容；返回正文恢复原选择。
- 窄窗口复用同一组页签；Esc 先关闭抽屉，再关闭详情返回技能库。
- 技能库网格和列表的 Agent 摘要固定按 Codex、Qoder、WorkBuddy 显示；仅显示已安装且启用的有效项。缺失某项时不以其他图标补位。
- 其余有效 Agent 汇总为 `+X`；提示列出名称，点击可展开，原有安装、卸载、等待状态保持。WorkBuddy AI 作为独立 Agent 计入其余项。

## 整体测试

| 检查 | 结果 |
| --- | --- |
| 后端测试 | 130/130 通过 |
| UI 测试 | 34/34 通过 |
| Electron 桥接测试 | 1/1 通过 |
| 构建 | 通过 |
| ESLint | 通过 |
| Chrome 侧栏交互 | 13/13 通过 |
| Chrome Agent 摘要交互 | 8/8 通过 |

浏览器实测包含：目录定位和高亮、互斥页签、保留阅读位置、键盘切换、主区切换、窄屏抽屉、Esc 返回、网格/列表图标顺序、准确的 `+3`、展开/收起，以及展开区 Cursor 在隔离目录里的真实部署/卸载。未访问真实技能库。结构化结果见 [results.json](output/detail-sidebar/results.json)。

## 截图

- [目录页签](output/playwright/detail-sidebar-toc.png)
- [项目结构页签](output/playwright/detail-sidebar-structure.png)
- [项目来源页签](output/playwright/detail-sidebar-source.png)
- [窄窗口抽屉](output/playwright/detail-sidebar-narrow.png)
- [网格三个图标与 +X](output/playwright/detail-agents-grid.png)
- [列表三个图标与 +X](output/playwright/detail-agents-list.png)

## 复现

在仓库目录执行种子脚本与隔离服务。演示库已存在时脚本拒绝覆盖。

```powershell
node output/detail-sidebar/seed.mjs
node backend/server.mjs --port 14319 --directory output/detail-sidebar/data/demo/app --home output/detail-sidebar/data/demo/home
```

另一终端执行：

```powershell
npx --cache output/detail-sidebar/data/npm-cache --yes --package @playwright/cli playwright-cli -s=detail-sidebar open http://127.0.0.1:14319/my-skills --browser chrome
npx --cache output/detail-sidebar/data/npm-cache --yes --package @playwright/cli playwright-cli -s=detail-sidebar run-code --filename output/detail-sidebar/verify-sidebar.mjs
npx --cache output/detail-sidebar/data/npm-cache --yes --package @playwright/cli playwright-cli -s=detail-sidebar run-code --filename output/detail-sidebar/verify-agents.mjs
```

## 边界

- 本次未重新打包或实机验收 Windows EXE；Electron 自动测试只覆盖桥接层。
- 浏览器使用虚构技能与客户端目录。已保留项目关联组件及调用链，但演示库没有关联项目，未执行真实项目关联操作。
- 构建保留 Browserslist 数据较旧和较大产物提示，没有构建错误。
- 原有未提交修改保留；同文件只提交本任务增量。隔离运行数据、下载缓存和暂存脚本清理，保留复现脚本、结果和截图。
