// Preset 管理命令：增删改、排序、成员排序与"应用到默认"。
// 应用语义沿用旧版：切换活动 Preset，撤销旧 Preset 独有的部署，再部署新 Preset 期望的工具目标；
// 单项目标失败不回滚已完成部署，但汇总为错误反馈。
export function presetCommands(store, library) {
  function applyPreset(id) {
    store.preset(id);
    const desired = new Set();
    for (const skillId of store.scenarioSkillIds(id)) {
      for (const toggle of store.scenarioSkillTools(id, skillId)) {
        if (toggle.enabled) desired.add(`${skillId}\n${toggle.tool}`);
      }
    }
    const previousId = store.activeScenarioId();
    if (previousId && previousId !== id) {
      for (const skillId of store.scenarioSkillIds(previousId)) {
        for (const toggle of store.scenarioSkillTools(previousId, skillId)) {
          if (toggle.enabled && !desired.has(`${skillId}\n${toggle.tool}`)) {
            try { library.unsyncFromTool(skillId, toggle.tool); }
            catch { // 旧目标撤销失败不阻断切换，保留现状由用户手动处理
            }
          }
        }
      }
    }
    store.setActiveScenario(id);
    const failures = [];
    for (const key of desired) {
      const [skillId, tool] = key.split("\n");
      try { library.deploy(skillId, tool); }
      catch (error) { failures.push(`${skillId} → ${tool}：${error.message}`); }
    }
    if (failures.length) throw new Error(`Preset 已切换，但部分技能部署失败：${failures.join("；")}`);
  }

  return {
    create_preset: { call: args => store.createPreset(args.name, args.description ?? null, args.icon ?? null), mutating: true },
    update_preset: { call: args => store.updatePreset(args.id, args.name, args.description ?? null, args.icon ?? null), mutating: true },
    delete_preset: { call: args => store.deletePreset(args.id), mutating: true },
    switch_preset: { call: args => applyPreset(args.id), mutating: true },
    apply_preset_to_default: { call: args => applyPreset(args.id), mutating: true },
    reorder_presets: { call: args => store.reorderPresets(Array.isArray(args.ids) ? args.ids : []), mutating: true },
    get_preset_skill_order: { call: args => store.scenarioSkillIds(args.presetId) },
    reorder_preset_skills: { call: args => store.reorderScenarioSkills(args.presetId, Array.isArray(args.skillIds) ? args.skillIds : []), mutating: true },
  };
}
