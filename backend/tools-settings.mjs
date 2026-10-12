import path from "node:path";

// 工具设置命令：自定义工具、全局启停、排序、技能目录覆盖与从列表移除。
// 全部状态保存在既有 settings 键中（custom_tools / disabled_tools / tool_order /
// custom_tool_paths / custom_tool_project_paths / hidden_tools），由 store.tools() 统一读取。
export function toolCommands(store) {
  // 用 allTools()：被移除（hidden）的工具也要能被找到，否则无法恢复。
  const requireTool = key => {
    const tool = store.allTools().find(item => item.key === key);
    if (!tool) throw new Error("工具不存在");
    return tool;
  };
  const updateSettingJson = (key, update) => {
    const value = update(store.settingJson(key, []));
    store.setSetting(key, JSON.stringify(value));
    return value;
  };

  return {
    add_custom_tool: { call: args => {
      const key = String(args.key ?? "").trim();
      const displayName = String(args.displayName ?? "").trim();
      const skillsDir = String(args.skillsDir ?? "").trim();
      if (!key || !/^[a-z0-9_-]+$/.test(key)) throw new Error("工具标识只能包含小写字母、数字、下划线和连字符");
      if (!displayName) throw new Error("工具名称不能为空");
      if (!skillsDir || !path.isAbsolute(skillsDir)) throw new Error("技能目录必须是绝对路径");
      if (store.tools().some(tool => tool.key === key)) throw new Error(`已存在同名工具：${key}`);
      updateSettingJson("custom_tools", custom => [...custom, {
        key, display_name: displayName, skills_dir: path.resolve(skillsDir),
        project_relative_skills_dir: args.projectRelativeSkillsDir ? String(args.projectRelativeSkillsDir) : null, category: "coding",
      }]);
    }, mutating: true },
    remove_custom_tool: { call: args => {
      const key = requireTool(args.key).key;
      if (!store.settingJson("custom_tools", []).some(tool => tool.key === key)) throw new Error("内置工具不可移除");
      updateSettingJson("custom_tools", custom => custom.filter(tool => tool.key !== key));
      updateSettingJson("disabled_tools", keys => keys.filter(item => item !== key));
      updateSettingJson("tool_order", keys => keys.filter(item => item !== key));
      updateSettingJson("custom_tool_paths", paths => { const next = { ...paths }; delete next[key]; return next; });
      updateSettingJson("custom_tool_project_paths", paths => { const next = { ...paths }; delete next[key]; return next; });
    }, mutating: true },
    set_tool_enabled: { call: args => {
      requireTool(args.key);
      const enabled = !!args.enabled;
      updateSettingJson("disabled_tools", keys => enabled ? keys.filter(item => item !== args.key) : [...new Set([...keys, args.key])]);
    }, mutating: true },
    set_all_tools_enabled: { call: args => {
      updateSettingJson("disabled_tools", () => args.enabled ? [] : store.tools().map(tool => tool.key));
    }, mutating: true },
    // 从 Agent 列表移除 / 恢复：只改设置，不触碰磁盘上的 Agent 程序本身，可随时恢复。
    hide_tool: { call: args => { store.setToolHidden(requireTool(args.key).key, true); }, mutating: true },
    restore_tool: { call: args => { store.setToolHidden(requireTool(args.key).key, false); }, mutating: true },
    get_hidden_tools: { call: () => store.hiddenTools() },
    get_tool_order_cmd: { call: () => store.settingJson("tool_order", []) },
    set_tool_order_cmd: { call: args => {
      const order = Array.isArray(args.order) ? args.order.map(String) : [];
      const known = new Set(store.tools().map(tool => tool.key));
      const unknown = order.filter(key => !known.has(key));
      if (unknown.length) throw new Error(`顺序列表包含未知工具：${unknown.join("、")}`);
      store.setSetting("tool_order", JSON.stringify(order));
    }, mutating: true },
    set_custom_tool_path: { call: args => {
      requireTool(args.key);
      const value = String(args.path ?? "").trim();
      if (!value || !path.isAbsolute(value)) throw new Error("技能目录必须是绝对路径");
      updateSettingJson("custom_tool_paths", paths => ({ ...paths, [args.key]: path.resolve(value) }));
    }, mutating: true },
    reset_custom_tool_path: { call: args => {
      requireTool(args.key);
      updateSettingJson("custom_tool_paths", paths => { const next = { ...paths }; delete next[args.key]; return next; });
    }, mutating: true },
    set_custom_tool_project_path: { call: args => {
      requireTool(args.key);
      const value = args.projectRelativeSkillsDir === null || args.projectRelativeSkillsDir === undefined
        ? null : String(args.projectRelativeSkillsDir).trim();
      updateSettingJson("custom_tool_project_paths", paths => {
        const next = { ...paths };
        if (value) next[args.key] = value; else delete next[args.key];
        return next;
      });
    }, mutating: true },
    reset_custom_tool_project_path: { call: args => {
      requireTool(args.key);
      updateSettingJson("custom_tool_project_paths", paths => { const next = { ...paths }; delete next[args.key]; return next; });
    }, mutating: true },
  };
}
