// 预加载脚本：向渲染进程暴露受控的桌面能力（目录选择、外链打开、确认框）。
// 应用内重启由页面调用 restart_app 命令完成（本地服务退出后主进程自动拉起并刷新）。
const { contextBridge, dialog, shell } = require("electron");

contextBridge.exposeInMainWorld("__desktopBridge__", {
  openDirectory: async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  },
  openExternal: url => {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) return shell.openExternal(url);
  },
  confirm: async message => {
    const result = await dialog.showMessageBox({ type: "question", buttons: ["确定", "取消"], defaultId: 0, cancelId: 1, message });
    return result.response === 0;
  },
});
