# 页面加载慢：定位与修复报告（2026-10-12）

结论先行：**应用内没有「整体慢」的页面，真正的异常点是「全局工作区」读取单个 Agent 的技能列表**
（最慢 5.2 秒），以及**启动后自动跑的那轮检查更新**（13–31 秒，且对失效来源反复重试）。
两处都已修，其余页面在 0.5 秒内出数据。

## 一、改动前 → 改动后

| 位置 | 改动前 | 改动后 |
| --- | --- | --- |
| `get_global_local_skills(claude_code)`（全局工作区页） | **5169ms** | 664ms（再进 444ms） |
| `get_global_local_skills(workbuddy)` | 2294ms | 477ms（再进 260ms） |
| `get_global_local_skills(codex)` | 1721ms | 1294ms（再进 282ms） |
| `check_all_skill_updates`（启动后 3s 自动跑的那轮） | **13390ms** | 29ms |
| 单个 local 技能 `check_skill_update` | 41ms | 4–8ms |
| 52 个 local 技能逐个检查合计 | ~2100ms | 243ms |
| `withCenterState`（工作区匹配 + 同步判定） | 1102ms | 158ms |
| 自动检查进行中打开页面（对照安静状态） | 331ms（安静 191ms） | 184ms（安静 194ms） |

逐页（改动后，无头 Chrome + `pushState` 切路由，与点侧栏同一条链路）：

| 页面 | 外壳出现 | 数据到位 | 最慢接口 |
| --- | --- | --- | --- |
| 工作台（整页首载） | 164ms | — | — |
| 技能库 | 78ms | 497ms | `get_skill_usage` 99ms |
| 调用记录 | 4ms | 595ms | `get_skill_activity` / `_sources` 各 87ms |
| 全局工作区（总览） | — | 5ms | — |
| 安装 Skills | 2ms | 733ms | `fetch_leaderboard` 727ms（访问 skills.sh，网络受限） |
| 备份 | 19ms | 37ms | — |
| 设置 | 11ms | 40ms | — |

## 二、根因

1. **`store.skill(id)` 是 O(N) 的**：实现是「`skills()` 重建整张技能表再 find」，而 `skills()` 每次都要读
   53 个 `SKILL.md` 并跑上百条查询。任何「按 id 逐个处理」的循环因此退化成 O(N²)：
   `check_all_skill_updates` 52 个技能就要 2.1 秒纯开销。
2. **`check_all_skill_updates` 忽略了前端一直在传的 `force`**：启动后 3 秒的无条件全量检查，每次都把已经
   查过的技能重查一遍；其中一个 git 技能的来源 URL 已失效，每次都要重试一次注定失败的 clone（实测 11–31 秒）。
3. **工作区读取把同一个目录整读了多遍**：`.claude/skills` 是指向 `.agents/skills` 的符号链接，
   23 个技能 / 857 个文件 / 120MB。`readSkillsRoot` 先算一遍内容指纹，`withCenterState` 又用
   **未规范化**的 `central_path` 当缓存键重算一遍 —— 而默认部署方式是 `symlink`，副本与中心本来就是
   同一个物理目录；再加上匹配循环里按「53 个已纳管 × 23 个工作区」调用 `realpathSync`（上千次系统调用）。
   只哈希一遍就要 620ms，一次请求里读了两遍以上。
4. **扫描进度通知引发前端放大**：后端约 250ms 推一次 `skill-activity-changed`，调用记录页与技能库页
   每次都整页重查（记录列表 + 来源 / 调用统计），页面持续发烫。

## 三、改法

- `backend/store.mjs`：`skill(id)` 改为按 id 单行查询（同一语义，O(1)）。
- `backend/server.mjs`：`check_all_skill_updates` 尊重 `force`。非强制轮次：10 分钟内查过的跳过；
  **上次失败的退避 60 分钟**。手动「检查全部更新」传 `force=true`，随时可强制。
- `backend/workspace.mjs`：
  · 新增 `cachedDirectoryHash()` —— 用「文件数 + 总字节 + mtime 最大/和」做前置指纹，指纹没变就复用上次的
    内容哈希（stat 一遍约 85ms，是整目录重读 620ms 的 1/7）。**写入类操作不经过这个缓存**，落盘判定仍现算。
  · `withCenterState` 的实时指纹缓存改按 **canonical 物理目录** 为键，并预置 `readSkillsRoot` 已算好的指纹。
  · `canonical()` 按请求缓存（`withCenterState` 进入时重置，不跨请求复用）。
- `src/views/SkillActivity.tsx`、`src/views/MySkills.tsx`：`skill-activity-changed` 刷新节流到 1.2s，
  调用记录页保留 5s 兜底定时。

## 四、验证

- `node --check` ×3、`tsc --noEmit`、`eslint .`、`npm run build`、`test:ui` 6/6 全绿。
- 后端 `node --test tests/backend/*.test.mjs`：**46/50**，与改动前完全相同的 4 项既有失败
  （2 项本机 git EBUSY、2 项引用用户已删除的 Preset「应用」链路）；改动的 `workspace.test.mjs`、
  `store.test.mjs` 全部通过。
- 首屏占位回归：`output/startup-perf/verify-splash.mjs` 5 段断言全过（窗口/白屏那条链路的改动没受影响）。

## 五、复现方式

```bash
node output/page-perf/probe-commands.mjs      # 逐命令计时（含冷/热）
node output/page-perf/probe.mjs               # 逐页画像（真实操作路径）
node output/page-perf/measure-workspace2.mjs claude_code   # readSkillsRoot vs withCenterState 分段
node output/page-perf/probe-contention.mjs old|new         # 与 git HEAD 的旧后端对照
node output/page-perf/measure-check.mjs       # 检查更新链路拆分
```

## 六、仍然慢的地方（未改，属数据自身问题）

| 位置 | 实测 | 说明 |
| --- | --- | --- |
| 技能详情「来源差异」页签 · `codex-ppt` | **11.4s** 后报错 | 该技能的来源 URL 已失效，这个页签要去 clone 远程；建议重新关联来源或删掉该技能 |
| 技能详情「来源差异」页签 · `dashi-ppt`（112MB） | 495ms（冷） | 要对比两侧目录内容，体积大就慢 |
| 安装 Skills 首屏 | 727ms | `fetch_leaderboard` 访问 skills.sh，网络受限时的正常代价 |

其余两个约 90–110ms 的接口（`get_skill_usage`、`get_skill_activity`）会阻塞事件循环，所以同一页并发调用会排队
（两处显示相同耗时）。目前页面总耗时约 0.5s，判为可接受，未做跨请求缓存以免引入过期风险。
