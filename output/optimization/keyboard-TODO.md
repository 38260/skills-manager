# O8 弹窗键盘操作

- [x] DetailSheet 面板初始焦点按 Shift+Tab 返回最后一个可操作项。
- [x] 确认框增加 dialog 语义、标题和说明关联，打开时焦点进入取消按钮。
- [x] Tab、Shift+Tab 保持在当前弹窗内，关闭时返回入口。
- [x] 共用焦点管理识别内嵌和 portal 同级弹窗，父层不吞掉子层键盘事件。
- [x] 执行中 Escape、遮罩、取消和关闭锁定；同步执行标记阻止重复确认。
- [x] 确认框所有按钮指定 button 类型，键盘焦点可见。
- [x] scoped ESLint 和实际组件语义测试（1/1），`git diff --check` 通过。
- [x] 根 agent 真实浏览器验证焦点循环、嵌套、执行锁定与返回焦点。
- [x] 根 agent 统一构建通过；整体测试另见主 TODO 与验收报告。

浏览器独立 fixture：`/tests/ui/dialogs.fixture.html`。只挂载实际弹窗组件，不调用后端或用户技能库。
