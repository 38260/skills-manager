import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// 本地服务端口：与 backend/server.mjs 的默认值一致，可用 SKILLS_MANAGER_PORT 覆盖。
const servicePort = process.env.SKILLS_MANAGER_PORT || "14200";

// 开发模式下自动拉起本地服务（backend/server.mjs），并随 Vite 退出而停止。
function localService(): Plugin {
  let child: ChildProcess | null = null;
  return {
    name: "skills-manager-local-service",
    apply: "serve",
    configureServer(server) {
      const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), "backend", "server.mjs");
      child = spawn(process.execPath, [entry, "--port", servicePort], {
        cwd: path.dirname(entry),
        stdio: "inherit",
        env: process.env,
        windowsHide: true,
      });
      const stop = () => {
        if (!child) return;
        child.kill();
        child = null;
      };
      server.httpServer?.once("close", stop);
      process.once("exit", stop);
    },
  };
}

export default defineConfig({
  plugins: [react(), localService()],
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${servicePort}`,
        ws: false,
      },
    },
    watch: {
      ignored: ["**/src-tauri/target/**"],
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
});
