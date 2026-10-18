import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";

test("Agent 摘要只展示指定三种，不补位，汇总数量与加载状态准确", async () => {
  const modulePath = path.join(process.cwd(), "tests/ui", `sync-dots-${process.pid}.mjs`);
  const result = await build({ entryPoints: ["src/components/SyncDots.tsx"], bundle: true, platform: "node", format: "esm", jsx: "automatic", packages: "external", write: false });
  fs.writeFileSync(modulePath, result.outputFiles[0].text, { flag: "wx" });
  try {
    const { SyncDots } = await import(pathToFileURL(modulePath).href);
    const i18n = createInstance();
    await i18n.init({ lng: "zh", resources: { zh: { translation: JSON.parse(fs.readFileSync("src/i18n/zh.json", "utf8")) } } });
    const tools = ["cursor", "workbuddy", "claude-code", "qoder", "codex", "workbuddy_ai"].map(key => ({ key, display_name: key, installed: true, enabled: true }));
    const skill = { targets: [{ tool: "codex" }] };
    const render = (overrides = {}) => renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(SyncDots, { skill, tools, limit: 6, onToggle() {}, ...overrides })));
    const labels = html => [...html.matchAll(/aria-label="([^"]+)"/g)].map(match => match[1]);
    const html = render();
    assert.deepEqual(labels(html).slice(0, 3).map(label => label.split(" · ")[0]), ["codex", "qoder", "workbuddy"]);
    assert.match(html, />\+3</);
    assert.match(html, /cursor, claude-code, workbuddy_ai/);
    assert.match(labels(html)[0], /synced/);
    const missing = render({ tools: tools.filter(tool => tool.key !== "qoder") });
    assert.deepEqual(labels(missing).slice(0, 2).map(label => label.split(" · ")[0]), ["codex", "workbuddy"]);
    assert.match(missing, />\+3</, "缺失的 Qoder 不应占用汇总数量");
    const unavailable = render({ tools: tools.map(tool => tool.key === "codex" ? { ...tool, enabled: false } : tool) });
    assert.deepEqual(labels(unavailable).slice(0, 2).map(label => label.split(" · ")[0]), ["qoder", "workbuddy"]);
    const pending = render({ pendingKey: "codex" });
    assert.match(pending, /disabled=""/);
    assert.match(pending, /animate-spin/);
    assert.match(render({ onToggle: undefined }), />\+3</, "只读摘要仍显示真实剩余数量");
    assert.doesNotMatch(render({ tools: [] }), /\+\d/);
  } finally { fs.unlinkSync(modulePath); }
});
