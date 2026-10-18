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
import { evidenceSummary } from "../../backend/activity/evidence.mjs";

test("证据卡片解码命令、高亮含正则字符的技能名，原文和上下文默认折叠", async () => {
  const modulePath = path.join(process.cwd(), "tests/ui", `activity-render-${process.pid}.mjs`);
  const result = await build({ entryPoints: ["src/components/ActivityEvidenceCard.tsx"], bundle: true, platform: "node", format: "esm", jsx: "automatic", packages: "external", write: false });
  fs.writeFileSync(modulePath, result.outputFiles[0].text, { flag: "wx" });
  try {
    const { ActivityEvidenceCard } = await import(pathToFileURL(modulePath).href);
    const i18n = createInstance();
    await i18n.init({ lng: "zh", resources: { zh: { translation: JSON.parse(fs.readFileSync("src/i18n/zh.json", "utf8")) } } });
    const record = { id: "one", skillName: "skill+[v2]", kind: "document" };
    const row = { type: "response_item", payload: { type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: 'Get-Content "C:\\skills\\skill+[v2]\\SKILL.md"\n<unsafe>' }) } };
    const excerpt = { focus: "20", lineKind: "line", kind: "jsonl", lines: [{ label: "20", text: JSON.stringify(row), summary: evidenceSummary(row) }], truncated: false };
    const html = renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(ActivityEvidenceCard, { record, excerpt })));
    assert.match(html, /读取技能文档/);
    assert.match(html, /exec_command/);
    assert.match(html, /<mark[^>]*>skill\+\[v2\]\\SKILL\.md<\/mark>/);
    assert.match(html, /&lt;unsafe&gt;/, "日志内容必须作为文本，不能注入 HTML");
    assert.equal([...html.matchAll(/<details /g)].length, 2);
    assert.doesNotMatch(html, /<details[^>]*\sopen(?:=|>)/);
    assert.match(html, /第 20 行/);
    assert.match(html, /复制命中内容/);
  } finally { fs.unlinkSync(modulePath); }
});
