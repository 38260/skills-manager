import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { build } from "esbuild";

// 验证真实组件的加载时机；仅 API 和上游延迟为替身，不写用户数据。
const root = path.resolve("output/detail-workspace-perf");
const counts = {};
const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { SkillDetailPanel } from "./src/components/SkillDetailPanel";
import "./src/i18n";
const skill = { id: "demo", name: "demo", description: "加载验证", source_type: "git", source_ref: "https://example.invalid/demo", central_path: "demo", updated_at: 1, tags: [], targets: [], preset_ids: [] };
createRoot(document.getElementById("root")).render(createElement(BrowserRouter, null, createElement(SkillDetailPanel, { skill, tools: [], projects: [], onClose() {} })));
` }, bundle: true, platform: "browser", format: "esm", jsx: "automatic", write: false });
const bundle = result.outputFiles[0].text;
const css = fs.readdirSync("dist/assets").find(name => name.endsWith(".css"));
const server = http.createServer(async (request, response) => {
  const send = (value, type = "application/json") => { response.setHeader("content-type", type); response.end(typeof value === "string" ? value : JSON.stringify(value)); };
  if (request.url === "/bundle.js") return send(bundle, "text/javascript");
  if (request.url === "/style.css") return send(fs.readFileSync(path.join("dist/assets", css)), "text/css");
  if (request.url === "/checks") return send({ counts });
  if (request.url?.startsWith("/api/invoke/")) {
    const command = request.url.split("/").pop();
    counts[command] = (counts[command] ?? 0) + 1;
    const document = { skill_id: "demo", filename: "SKILL.md", content: "# demo\n\n本地正文已经加载。", central_path: "demo" };
    if (command === "get_skill_document") return send({ ok: true, data: document });
    if (command === "get_skill_files") return send({ ok: true, data: { skill_id: "demo", root: "demo", entries: [] } });
    if (command === "get_source_skill_document" || command === "get_skill_source_diff") {
      await new Promise(resolve => setTimeout(resolve, 650));
      return send({ ok: true, data: command === "get_source_skill_document"
        ? { ...document, content: "# demo\n\n来源正文已经加载。", source_label: "示例来源", revision: "demo-revision" }
        : { skill_id: "demo", source_label: "示例来源", revision: "demo-revision", entries: [] } });
    }
    return send({ ok: false, message: "测试未提供该接口" });
  }
  send('<html lang="zh"><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>', "text/html");
});
server.listen(0, "127.0.0.1", () => console.log(`Detail fixture: http://127.0.0.1:${server.address().port}`));
process.on("SIGINT", () => {
  fs.writeFileSync(path.join(root, process.argv[2] ?? "detail-checks.json"), JSON.stringify({ counts }, null, 2) + "\n");
  server.closeAllConnections(); server.close(() => process.exit(0));
});
