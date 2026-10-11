// 预加载脚本：向渲染进程暴露受控的桌面能力（目录选择、外链打开、确认框）。
// 应用内重启由页面调用 restart_app 命令完成（本地服务退出后主进程自动拉起并刷新）。
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("__desktopBridge__", {
  openDirectory: () => ipcRenderer.invoke("desktop:open-directory"),
  openSkillFile: () => ipcRenderer.invoke("desktop:open-skill-file"),
  openExternal: url => ipcRenderer.invoke("desktop:open-external", url),
  confirm: message => ipcRenderer.invoke("desktop:confirm", message),
});
