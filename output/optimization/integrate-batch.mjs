import fs from "node:fs";
const file="src/views/MySkills.tsx";let text=fs.readFileSync(file,"utf8").replace(/\r\n/g,"\n");
function section(start,end,replacement){const a=text.indexOf(start),b=text.indexOf(end,a);if(a<0||b<0)throw new Error(start);text=text.slice(0,a)+replacement+"\n\n"+text.slice(b);}
text=text.replace("    selectedIds,\n", "    selectedIds, setSelectedIds,\n");
section("  const handleBatchDelete = async () => {", "  /** The update the user", `  type BatchTask = { id: string; skillId: string; name: string; run: () => Promise<void | Pick<OperationItem, "status" | "message">> };

  async function runOperations(title: string, tasks: BatchTask[]) {
    const execute = async (selected: BatchTask[]) => {
      const items: OperationItem[] = [];
      for (const task of selected) {
        try { const result = await task.run(); items.push({ id: task.id, name: task.name, status: "success", message: "已完成", ...result }); }
        catch (cause) { items.push({ id: task.id, name: task.name, status: "failed", message: getErrorMessage(cause, t("common.error")) }); }
      }
      await Promise.all([refreshManagedSkills(), refreshPresets(), refreshTools()]);
      const failedIds = new Set(items.filter(item => item.status === "failed").map(item => tasks.find(task => task.id === item.id)!.skillId));
      setSelectedIds(failedIds);
      if (failedIds.size) setIsMultiSelect(true); else exitMultiSelect();
      return items;
    };
    const items = await execute(tasks);
    setOperationReport({ title, items, retry: ids => execute(tasks.filter(task => ids.includes(task.id))) });
    return items;
  }

  const handleBatchDelete = async () => {
    const tasks = skills.filter(skill => selectedIds.has(skill.id)).map(skill => ({ id: skill.id, skillId: skill.id, name: skill.display_name || skill.name,
      run: async () => { await api.deleteManagedSkill(skill.id); if (selectedSkill?.id === skill.id) closeSkillDetail(); },
    }));
    await runOperations("批量删除结果", tasks);
  };

  const handleBatchEditTags = async (adds: string[], removes: string[]) => {
    const tasks = skills.filter(skill => selectedIds.has(skill.id)).map(skill => ({ id: skill.id, skillId: skill.id, name: skill.display_name || skill.name,
      run: async () => {
        // 重试时读取当前标签，只应用本次增减，不覆盖失败后用户新添加的分类。
        const current = (await api.getManagedSkills()).find(item => item.id === skill.id);
        if (!current) throw new Error("技能已不存在");
        const next = [...new Set([...current.tags.filter(tag => !removes.includes(tag)), ...adds])];
        await api.setSkillTags(skill.id, next);
      },
    }));
    await runOperations("批量分类结果", tasks); await refreshAllTags();
  };

  const handleBatchTogglePreset = async () => {
    if (!viewedPreset || batchToggling) return;
    const enabling = anyDisabled, presetId = viewedPreset.id;
    setBatchToggling(true);
    try {
      await runOperations(enabling ? "批量加入 Preset 结果" : "批量移出 Preset 结果", togglableSelectedSkills.map(skill => ({ id: skill.id, skillId: skill.id, name: skill.display_name || skill.name,
        run: () => enabling ? api.addSkillToPreset(skill.id, presetId) : api.removeSkillFromPreset(skill.id, presetId),
      })));
    } finally { setBatchToggling(false); }
  };

  const handleBatchSyncAgents = async (agentKeys: string[]) => {
    const tasks: BatchTask[] = [];
    for (const skill of skills.filter(item => selectedIds.has(item.id))) for (const key of agentKeys) {
      if (skill.targets.some(target => target.tool === key)) continue;
      tasks.push({ id: skill.id + ":" + key, skillId: skill.id, name: (skill.display_name || skill.name) + " → " + (tools.find(tool => tool.key === key)?.display_name || key), run: () => api.syncSkillToTool(skill.id, key) });
    }
    await runOperations("批量部署结果", tasks);
  };

  function updateTask(skill: ManagedSkill): BatchTask {
    let failedTools: string[] = [];
    return { id: skill.id, skillId: skill.id, name: skill.display_name || skill.name, run: async () => {
      let deployments: api.DeploymentResult[];
      if (failedTools.length) deployments = await api.retrySkillDeployments(skill.id, failedTools);
      else {
        const result = ["local", "import"].includes(skill.source_type) ? await api.reimportLocalSkill(skill.id) : await api.updateSkill(skill.id);
        if (result.pending_removals.length) return { status: "held", message: "存在本地编辑或文件移除，请单项更新并确认" };
        deployments = result.deployments || [];
      }
      failedTools = deployments.filter(item => item.status === "failed").map(item => item.tool);
      return { status: failedTools.length ? "failed" : "success", message: "中央库已更新" + (deployments.length ? "；" + deployments.map(item => item.tool + "：" + item.message).join("；") : "") };
    }};
  }

  const handleBatchRefresh = async () => {
    const targets = skills.filter(skill => selectedIds.has(skill.id) && canRefresh(skill));
    if (!targets.length || batchUpdating) return;
    setBatchUpdating(true);
    try { await runOperations("所选技能更新结果", targets.map(updateTask)); }
    finally { setBatchUpdating(false); }
  };`);
section("  const handleUpdateAvailableSkills = async () => {", "  const handleCheckAllUpdates = async () => {", `  const handleUpdateAvailableSkills = async () => {
    const targets = skills.filter(skill => skill.update_status === "update_available" && canRefresh(skill));
    if (!targets.length || batchUpdating) return;
    setBatchUpdating(true);
    try { await runOperations("全部技能更新结果", targets.map(updateTask)); }
    finally { setBatchUpdating(false); }
  };`);
fs.writeFileSync(file,text);
