import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// 独立验收只代理隔离服务，不加载项目开发插件或用户技能库。
export default defineConfig({plugins:[react()],server:{host:"127.0.0.1",port:4179,strictPort:true,proxy:{"/api":"http://127.0.0.1:4178"}}});
