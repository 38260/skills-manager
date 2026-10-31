# 部署覆盖 · 未部署名单验收

交付日期：2026-10-19。验证对象为当前工作区源码、Vite 构建和隔离演示库。

## 行为

- 工作台「部署覆盖」卡片上的 `N 项未部署` 由纯文本改为可展开入口：点一下列出到底是哪几个技能，点第二次或按 Esc 收起。
- 名单口径与卡片数字同源：都来自 `targets.length === 0`，不再各自算一遍（原先用「总数 - 已同步」推差值，两个口径不一致时会给出对不上的数字）。
- 名单行优先显示别名（`display_name`），超长名截断并带 `title` 悬浮全量名称。
- 点击任一行收起面板并打开该技能的全局详情弹层，在原页面就能完成部署；面板不会随页面跳走。
- 点击面板外区域同样收起；Esc 由面板先消费，不会连带关闭已打开的详情弹层。
- 未部署数归零时不再保留展开入口，改为 `✓ 全部技能已部署`，与 `100%` 一致。
- 中文 / 繁体 / 英文三套文案齐备，深色主题沿用既有语义色，无新增硬编码颜色。

## 整体测试

| 检查 | 结果 |
| --- | --- |
| 后端测试 | 130/130 通过 |
| UI 测试 | 38/38 通过（新增 4 项未部署名单用例） |
| Electron 桥接测试 | 1/1 通过 |
| 构建 | 通过 |
| ESLint | 通过 |
| Chrome 隔离实测 | 29/29 通过 |

浏览器实测包含：卡片数字与名单一致、默认收起、展开后名单为那 2 个（含别名与超长名）、面板紧贴按钮且未被卡片裁切、层级、Esc 收起、外点收起、行点击进详情且面板收起、英文界面、深色主题、960 窄窗口无横向溢出、全部署后的完成态。未访问真实技能库。

结构化结果见 [report.json](output/pending-deploy/evidence/run/report.json)。

## 截图

- [收起态](output/pending-deploy/evidence/run/01_collapsed_light.png)
- [展开名单](output/pending-deploy/evidence/run/02_expanded_light.png)
- [点击名单进详情](output/pending-deploy/evidence/run/03_detail_from_list.png)
- [英文界面](output/pending-deploy/evidence/run/04_expanded_en.png)
- [深色主题](output/pending-deploy/evidence/run/05_expanded_dark.png)
- [960 窄窗口](output/pending-deploy/evidence/run/06_expanded_narrow.png)
- [全部部署完成态](output/pending-deploy/evidence/run/07_all_deployed.png)

## 复现

一条命令即可（脚本自建隔离库、拉起后端与无头 Chrome，不会碰真实技能库）：

```powershell
node output/pending-deploy/verify.mjs run
```

隔离数据写在 `output/pending-deploy/data/run-*`，每次验收用全新目录。

## 边界

- 本次未重新打包或实机验收 Windows EXE；Electron 自动测试只覆盖桥接层。
- 名单只回答「哪些没有部署」，不提供一键批量部署入口；部署动作仍走技能详情，避免在仪表盘引入写操作。
- 卡片的「未部署」只按 Agent 维度判定，不含项目工作区内的差异（那部分仍由下方「同步提醒」负责）。
- `output/pending-deploy/data` 下历次运行的隔离数据未自动清理：本机 `fs.rmSync` 被安全删除垫片接管，删目录会走回收站失败，需要时手动整体删除即可。
- 原有未提交修改保留；同文件只提交本任务增量。
