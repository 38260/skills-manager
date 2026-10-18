import fs from "node:fs";
const copy={
  zh:{desktopCloseUnavailable:"当前 Electron 版本关闭窗口后退出，暂不支持托盘或关闭后隐藏。已有配置保留。",browserCloseUnavailable:"网页模式由浏览器管理关闭行为，托盘设置不适用。",proxyUnavailable:"当前版本的本地服务不使用此代理设置，请使用系统或 Git 的网络配置。已有值保留。",manualAppUpdate:"当前版本通过下载发行包更新，不支持应用内自动安装。",scheduleUnavailable:"当前版本只在启动后检查技能更新；定时检查周期暂不生效。"},
  en:{desktopCloseUnavailable:"This Electron version exits when its window closes. Tray and hide-on-close are unavailable; saved settings are retained.",browserCloseUnavailable:"The browser controls closing this page. Tray settings do not apply.",proxyUnavailable:"The local service does not use this proxy setting. Use your system or Git network configuration. The saved value is retained.",manualAppUpdate:"Update this version by downloading a release. In-app installation is unavailable.",scheduleUnavailable:"This version checks skill updates after startup. Scheduled intervals are unavailable."},
  "zh-TW":{desktopCloseUnavailable:"目前 Electron 版本關閉視窗後退出，暫不支援系統匣或關閉後隱藏。既有設定保留。",browserCloseUnavailable:"網頁模式由瀏覽器管理關閉行為，系統匣設定不適用。",proxyUnavailable:"目前版本的本機服務不使用此代理設定，請使用系統或 Git 的網路設定。既有值保留。",manualAppUpdate:"目前版本透過下載發行包更新，不支援應用程式內自動安裝。",scheduleUnavailable:"目前版本僅在啟動後檢查技能更新；定時檢查週期暫不生效。"},
};
for(const [locale,values] of Object.entries(copy)) {
  const filename=`src/i18n/${locale}.json`,data=JSON.parse(fs.readFileSync(filename,"utf8"));
  const {scheduleUnavailable,...settings}=values;
  Object.assign(data.settings,settings);data.settings.autoUpdate.scheduleUnavailable=scheduleUnavailable;
  fs.writeFileSync(filename,JSON.stringify(data,null,2)+"\n");
}
