# 调用证据与技能跳转验收

交付日期：2026-10-19。测试对象：当前工作区源码、最终 Vite 构建与隔离演示库；不读取或修改真实技能库。

## 交付行为

- 调用位置显示文件名及原始行号，SQLite 显示记录 ID。
- 默认展示动作、实际工具名、解码后的命中内容；技能名及 `SKILL.md` 局部高亮，可复制内容。
- 完整目标记录先解析再提取证据，原始行超过 4000 字符不再导致后置命中内容丢失。
- 上下文和原始记录独立折叠；相邻消息注明不一定属于同一调用。损坏结构回退原文，缺失文件明确提示。
- 精确关联或唯一名称关联的技能名显示下划线链接；名称关联保留提示，未关联技能没有虚假入口。
- 技能详情覆盖当前页面，点击“返回调用记录”或 Esc 关闭；返回保留搜索、工具筛选、页码、选中项、滚动位置和入口焦点。
- 调用记录页使用外层允许的宽度，详情栏随窗口扩大到 420/480px；窄窗口继续采用上下布局。

## 整体测试

| 检查 | 结果 |
| --- | --- |
| `npm test` 后端 | 130/130 通过 |
| `npm test` UI | 33/33 通过 |
| `npm test` Electron 桥接 | 1/1 通过 |
| `npm run build` | 通过 |
| `npm run lint` | 通过 |
| `git diff --check` | 通过 |
| Chrome 实际交互 | 15/15 通过 |

最初两项 Git 取消测试被沙箱禁止终止自身子进程；允许该测试所需权限后，已重新执行完整 `npm test` 并全部通过。未修改测试标准或取消机制。构建保留 Browserslist 数据较旧和产物体积提示，无构建错误。

浏览器检查覆盖：技能名打开真实详情组件、返回现场、键盘 Enter/Esc、焦点恢复、长行证据、局部高亮、复制、上下文、原文截断、切换记录重置、损坏日志回退、缺失日志、未关联技能和窄窗口可见性。

结构化验收结果：[results.json](output/activity-evidence/results.json)。

## 实际界面

- [浅色默认视图](output/playwright/activity-evidence-light.png)
- [浅色上下文展开](output/playwright/activity-evidence-context.png)
- [深色默认视图](output/playwright/activity-evidence-dark.png)
- [窄窗口详情](output/playwright/activity-evidence-narrow.png)

截图使用虚构技能、项目与日志，不包含真实用户调用数据。

## 复现浏览器验收

在仓库目录执行；演示库存在时种子脚本拒绝覆盖，防止误改已有数据。

```powershell
node output/activity-evidence/seed.mjs
node backend/server.mjs --port 14318 --directory output/activity-evidence/data/demo/app --home output/activity-evidence/data/demo/home
```

另一终端执行：

```powershell
npx --cache output/activity-evidence/data/npm-cache --yes --package @playwright/cli playwright-cli -s=activity-evidence open http://127.0.0.1:14318/skill-activity --browser chrome
npx --cache output/activity-evidence/data/npm-cache --yes --package @playwright/cli playwright-cli -s=activity-evidence run-code --filename output/activity-evidence/verify-browser.mjs
```

## 验证边界与工作区

- 六类客户端的字段投影、JSONL、zstd、SQLite 由自动测试覆盖；浏览器使用 Codex 格式的虚构日志，未对六种真实客户端逐一实机复验。
- 普通上下文读取目标前后各两行；SQLite 只展示对应 part。原始记录有长度上限，完整内容使用“跳转到日志”查看。
- “已返回”代表工具返回，不代表整个任务成功。
- Windows EXE 未重新打包或实机验收；本次源码与浏览器结果不能代替便携版验收。
- 保留原有未提交修改。同文件的翻译与详情改动只提交本次增量；另一个任务新增的状态徽章文件不纳入本次提交。
- 临时暂存辅助脚本、下载缓存和隔离运行数据清理；保留种子/交互脚本、报告和四张验收截图。
