// 首屏占位（index.html 里内联的 #boot-splash）的收尾。
// 占位一直盖在应用之上，直到「首次数据加载结束」才淡出，这样启动期间用户看到的
// 是明确的进度反馈，而不是白屏或一张还没有数据的空壳页面。
//
// 这里刻意不做「React 挂载即移除」：挂载时技能/项目列表还是空的，先露出 0 值再填数
// 反而更像卡顿。收尾统一交给 AppProvider 的首次加载流程（成功或失败都要收）。
const BOOT_SPLASH_ID = "boot-splash";

export function dismissBootSplash() {
  const element = document.getElementById(BOOT_SPLASH_ID);
  if (!element) return;
  element.classList.add("is-done");
  window.setTimeout(() => element.remove(), 200);
}

/** 兜底：任何意外（初始化抛错、事件丢失）都不该让占位页把应用永久挡住。 */
export function armBootSplashSafety(ms = 20000) {
  window.setTimeout(dismissBootSplash, ms);
}
