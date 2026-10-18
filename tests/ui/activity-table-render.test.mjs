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

test("调用记录的精确关联与唯一名称关联显示链接，未关联技能不生成假入口", async () => {
  const modulePath = path.join(process.cwd(), "tests/ui", `activity-table-${process.pid}.mjs`);
  const result = await build({ entryPoints: ["src/components/ActivityTable.tsx"], bundle: true, platform: "node", format: "esm", jsx: "automatic", packages: "external", write: false });
  fs.writeFileSync(modulePath, result.outputFiles[0].text, { flag: "wx" });
  try {
    const { ActivityTable } = await import(pathToFileURL(modulePath).href);
    const i18n = createInstance();
    await i18n.init({ lng: "zh", resources: { zh: { translation: JSON.parse(fs.readFileSync("src/i18n/zh.json", "utf8")) } } });
    const base = { tool: "codex", project: "/demo", timestamp: null, kind: "document", trigger: "automatic", status: "returned" };
    const items = [
      { ...base, id: "1", skillName: "exact", managedSkillId: "one" },
      { ...base, id: "2", skillName: "by-name", usageSkillId: "two" },
      { ...base, id: "3", skillName: "unlinked", managedSkillId: null },
    ];
    const html = renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(ActivityTable, { items, selectedId: "1", onSelect() {}, onOpenSkill() {} })));
    assert.equal([...html.matchAll(/aria-label="[^"]* · 打开技能详情"/g)].length, 2);
    assert.match(html, /text-accent-dark underline decoration-accent/);
    assert.match(html, /按「技能名在技能库中唯一」归属/);
    assert.match(html, /unlinked · 未关联技能库/);
    assert.doesNotMatch(html, /aria-label="unlinked · 打开技能详情"/);
  } finally { fs.unlinkSync(modulePath); }
});
