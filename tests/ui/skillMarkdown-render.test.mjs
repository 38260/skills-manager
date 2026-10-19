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

test("实际 Markdown 组件保留正文，详情代码提供语言／行号／复制，默认预览不改变", async () => {
  const modulePath = path.join(process.cwd(), "tests/ui", `markdown-render-${process.pid}.mjs`);
  const result = await build({ entryPoints: ["src/components/SkillMarkdown.tsx"], bundle: true, platform: "node", format: "esm", jsx: "automatic", packages: "external", write: false });
  fs.writeFileSync(modulePath, result.outputFiles[0].text, { flag: "wx" });
  try {
    const { SkillMarkdown } = await import(pathToFileURL(modulePath).href);
    const i18n = createInstance();
    await i18n.init({ lng: "zh", resources: { zh: { translation: JSON.parse(fs.readFileSync("src/i18n/zh.json", "utf8")) } } });
    const render = props => renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(SkillMarkdown, props)));
    const content = "# UI Design\n\n## 适用场景\n\n```ts\nconst value = 1;\nsecond();\n```\n\n```\n<section>safe</section>\n```";
    const detail = render({ content, hideFirstHeading: true, repeatedTitle: "ui-design", variant: "detail", headingIdPrefix: "sample" });
    assert.ok(!detail.includes(">UI Design</h1>"));
    assert.ok(detail.includes('id="sample-heading-2"'), "目录与正文使用同一行号");
    assert.match(detail, /TypeScript/);
    assert.match(detail, /纯文本/);
    assert.match(detail, /aria-label="复制"/);
    assert.match(detail, /aria-hidden="true"[^>]*>2<\/span>/);
    assert.match(detail, /&lt;section&gt;safe&lt;\/section&gt;/);
    assert.ok(!detail.includes("<section>safe</section>"), "代码内容不能作为 HTML 执行");
    const bodyTitle = render({ content: "# 适用场景\n正文", hideFirstHeading: true, repeatedTitle: "ui-design", variant: "detail" });
    assert.match(bodyTitle, />适用场景<\/h1>/, "不删除与技能名不同的正文标题");
    const normal = render({ content });
    assert.ok(!normal.includes("skill-detail-code"));
    assert.ok(normal.includes("max-w-[860px]"), "非详情场景保留窄栏阅读宽度");
    assert.match(normal, />UI Design<\/h1>/);
    // 详情页正文跟着主区自适应，不再自带宽度上限（否则宽屏两侧会空出大块留白）。
    assert.ok(!detail.includes("max-w-[860px]"), "详情正文不应再限制 860px");
    assert.ok(detail.includes("skill-detail-markdown"));
  } finally { fs.unlinkSync(modulePath); }
});
