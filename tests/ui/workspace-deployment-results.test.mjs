import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";

test("工作区部署结果明确显示中央库完成、逐 Agent 状态及仅失败项重试", async () => {
  const modulePath = path.join(process.cwd(), "tests/ui", `workspace-deploy-results-${process.pid}.mjs`);
  const built = await build({
    entryPoints: ["src/components/WorkspaceDeploymentResults.tsx"], bundle: true, platform: "node",
    format: "esm", jsx: "automatic", packages: "external", write: false,
  });
  fs.writeFileSync(modulePath, built.outputFiles[0].text, { flag: "wx" });
  try {
    const { WorkspaceDeploymentResults } = await import(pathToFileURL(modulePath).href);
    for (const language of ["zh", "en", "zh-TW"]) {
      const translations = JSON.parse(fs.readFileSync(`src/i18n/${language}.json`, "utf8"));
      const i18n = createInstance();
      await i18n.init({ lng: language, resources: { [language]: { translation: translations } } });
      for (const failed of [true, false]) {
        const props = {
          result: { id: "alpha", name: "alpha", display_name: "Alpha", deployments: [
            { tool: "codex", status: failed ? "failed" : "success", message: failed ? "本地修改已保留" : "已同步" },
            { tool: "cursor", status: "success", message: "已同步" },
          ] },
          tools: [{ key: "codex", display_name: "Codex" }, { key: "cursor", display_name: "Cursor" }],
          onChanged: async () => {}, onClose: () => {},
        };
        const html = renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(WorkspaceDeploymentResults, props)));
        assert.ok(html.includes(i18n.t("optimization.deploymentResultsTitle", { name: "Alpha" })));
        assert.ok(html.includes("Codex")); assert.ok(html.includes("Cursor"));
        assert.ok(html.includes(i18n.t("optimization.resultsSummary", { success: failed ? 1 : 2, failed: failed ? 1 : 0, held: 0 })));
        assert.equal(html.includes(i18n.t("optimization.retryFailed", { count: 1 })), failed);
        if (failed) assert.ok(html.includes("本地修改已保留"));
      }
    }
  } finally { fs.unlinkSync(modulePath); }
});
