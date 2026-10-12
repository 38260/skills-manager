// Preset 管理命令：增删改、排序与成员排序。
// 注意：这里不再有「应用 Preset」命令 —— 自 v1.16 起，应用由工作区页面的 PresetBar
// 直接调用 syncSkillToTool / unsyncSkillFromTool 完成（即时同步），不经过本模块。
export function presetCommands(store) {
  return {
    create_preset: { call: args => store.createPreset(args.name, args.description ?? null, args.icon ?? null), mutating: true },
    update_preset: { call: args => store.updatePreset(args.id, args.name, args.description ?? null, args.icon ?? null), mutating: true },
    delete_preset: { call: args => store.deletePreset(args.id), mutating: true },
    reorder_presets: { call: args => store.reorderPresets(Array.isArray(args.ids) ? args.ids : []), mutating: true },
    get_preset_skill_order: { call: args => store.scenarioSkillIds(args.presetId) },
    reorder_preset_skills: { call: args => store.reorderScenarioSkills(args.presetId, Array.isArray(args.skillIds) ? args.skillIds : []), mutating: true },
  };
}
