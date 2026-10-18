import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { i18nReady } from "./i18n";
import { logStartupEvent } from "./lib/tauri";
import { armBootSplashSafety } from "./lib/bootSplash";
import "./index.css";
import App from "./App.tsx";

// index.html 里的首屏占位由 AppProvider 首次加载完成后移除；
// 这里只挂一个兜底，避免初始化异常时占位页把应用永久挡住。
armBootSplashSafety();

await i18nReady;
logStartupEvent("i18n_ready", performance.now()).catch(() => {});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
logStartupEvent("root_rendered", performance.now()).catch(() => {});
