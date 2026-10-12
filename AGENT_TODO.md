# Agent 工作 Todo

> 工作约定：每个「小功能」独立完成 → 跑静态检查（`npx tsc --noEmit` + `npm run build`）→ **提交一次 Git** → 回到这里勾选。
> 提交时只带该小功能相关文件，不捆绑用户自己的 WIP。

---

## 进行中

（暂无）

---

## 已完成

### ✅ 小功能：清理 Preset「应用 / 活动」死代码（2026-10-12）

**背景**：v1.16+ 起点击侧边栏 Preset 不再触发应用（`tauri.ts` 曾标 `@deprecated`），
导致 `activePreset`、`applyPresetToDefault`、后端 `apply_preset_to_default` / `switch_preset`
全部失去调用点。技能库页删掉单技能开关后，这条链路更无用途。

- [x] 前端：删除 `activePreset` state / 接口字段 / value 导出；`viewedPreset` resolve 去掉该依赖
- [x] 前端：删除 `handleApplyPresetToDefault` 及其接口与 value 导出；`refreshPresets` 不再拉 `getActivePreset`
      （连带删掉 `lastActivePresetIdRef` 与那段「跟随外部切换」的逻辑）
- [x] 前端：`tauri.ts` 删除 `getActivePreset` / `switchPreset` / `applyPresetToDefault`
- [x] 后端：`presets.mjs` 删除 `switch_preset` / `apply_preset_to_default` 命令与 `applyPreset` 函数
      （`presetCommands` 签名从 `(store, library)` 收敛为 `(store)`）
- [x] 后端：`store.mjs` 删除失去调用点的 `setActiveScenario`
- [x] 后端：`server.mjs` 删除 `get_active_preset` 命令
- [x] **保留** `activeScenarioId()` 及其在 `sync_skill_to_tool` / `unsync_skill_from_tool` /
      `set_skill_tool_toggle` 里的分支 —— 它们读 `active_scenario` 表，删除会改变同步行为，另行评估
- [x] 验证：`node --check` ×3 ✓ / `npx tsc --noEmit` ✓ / `npx eslint` ✓ / `npm run build` ✓
      / 无头截图确认侧边栏 Preset（Default 高亮）、筛选条、分类标签、列表列对齐均正常
- [x] 提交 Git

### ✅ 小功能：删除技能库的「Preset 单技能开关」（2026-10-12）

**背景**：用户在列表视图看到最右侧的启用开关，确认不需要这个入口（语义是把技能加入/移出当前 Preset）。
**保留**：多选后的批量启停入口（`handleBatchTogglePreset`）、行首状态点。

- [x] 列表视图：删除 `ToggleSwitch`；操作列宽 `w-[72px]` → `w-[32px]`
- [x] 网格视图：删除卡片底部的 `ToggleSwitch`
- [x] 删除不再使用的 `handleTogglePreset` 函数与 `ToggleSwitch` 导入
- [x] 验证：`npx tsc --noEmit` ✓ / `npx eslint` ✓ / `npm run build` ✓
      / 无头截图确认两个视图 `role="switch"` 数量均为 **0**，列表列仍完全对齐
- [x] 提交 Git

### ✅ 小功能：调用记录新增 WorkBuddy AI 来源（2026-10-12）

**背景**：WorkBuddy 与 WorkBuddy AI 是两个独立产品，日志分别在 `~/.workbuddy` 与 `~/.workbuddy-ai`，
原先只采集前者。

- [x] `backend/activity/store.mjs`：`TOOLS` 加 `workbuddy_ai`；`defaultSources()` 加路径
- [x] `backend/activity/scanner.mjs`：`parsers` 复用 `parseWorkbuddy`
- [x] `src/lib/activity.ts`：`activityTools` / `toolNames` / `toolIconKeys`
- [x] 验证：隔离环境放入真实日志样本 → 来源数 5→6，解析出 Skill 调用记录
- [x] 真实配置已登记（`sources` 表出现 `workbuddy_ai`）

### ✅ 小功能：修复技能库列表视图列不对齐（2026-10-12）

**背景**：列表视图除描述列外，作者/标签/状态组都是内容自适应宽度，导致每行列位置漂移。

- [x] 除描述列外全部固定宽度；「缺失来源」改为固定槽位
- [x] 验证：6 行各列起始 x 坐标完全一致
- [x] 提交 Git

---

## 待办池（用户已提出、尚未开始）

- 用 `codex-ppt` 技能生成 skills-manager 的项目介绍 PPT —— 停在「2 张样张已确认」阶段，
  下一步是生成剩余 8 页 → QA → 写讲稿 → 组装 `.pptx`。
