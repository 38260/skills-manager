import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// 独立端口和构建目录，不启动项目开发插件，不覆盖主任务的 dist。
export default defineConfig({ plugins: [react()], build: { outDir: "output/status-badge/data/dist" }, preview: {
  host: "127.0.0.1", port: 4197, strictPort: true, proxy: { "/api": { target: "http://127.0.0.1:4198", changeOrigin: false } },
} });
