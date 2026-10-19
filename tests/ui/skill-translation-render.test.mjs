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

test("双语文档默认有中文选中文、无中文选原文；内容、标题锚点与错误提示一致", async () => {
  const modulePath = path.join(process.cwd(), "tests/ui", `translation-render-${process.pid}.mjs`);
  const result = await build({ stdin: { contents: 'export { SkillTranslationReader, SkillTranslationControls } from "./src/components/SkillTranslationReader.tsx"; export { resolveDocumentLanguage } from "./src/lib/skillTranslation.ts";', resolveDir: process.cwd() }, bundle: true, platform: "node", format: "esm", jsx: "automatic", packages: "external", write: false });
  fs.writeFileSync(modulePath, result.outputFiles[0].text, { flag: "wx" });
  try {
    const { SkillTranslationReader, SkillTranslationControls, resolveDocumentLanguage } = await import(pathToFileURL(modulePath).href);
    const translations = JSON.parse(fs.readFileSync("src/i18n/skillTranslation.json", "utf8"));
    const i18n = createInstance();
    await i18n.init({ lng: "zh", resources: { zh: { translation: { skillTranslation: translations.zh } }, en: { translation: { skillTranslation: translations.en } } } });
    const translation = { skill_id: "sample", content: "## 中文目录\n中文正文\n\n```js\nconst original = true;\n```", source_hash: "a".repeat(64), translated_source_hash: "a".repeat(64), revision: "v1", updated_at: 1, stale: false };
    // 默认选中「中文版」不再取决于译文是否存在：缺译本时正文回落到原文，由角标提示。
    assert.equal(resolveDocumentLanguage(null), "zh-CN");
    assert.equal(resolveDocumentLanguage("zh-CN"), "zh-CN");
    assert.equal(resolveDocumentLanguage("original"), "original");
    const state = { translation, loading: false, error: "", reload() {}, accept() {} };
    const props = { skillId: "sample", original: "## English heading\nEnglish content", ...state, language: "zh-CN", draftOpen: false, onDraftClose() {}, headingIdPrefix: "sample", repeatedTitle: "sample", onLanguageChange() {}, onSaved() {} };
    const render = overrides => renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(SkillTranslationReader, { ...props, ...overrides })));
    // 语言切换入口已移到页签行（控件组件），正文区只留内容本身。
    const controls = overrides => renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(SkillTranslationControls, { skillId: "sample", state: { ...state, ...overrides.state }, language: overrides.language ?? "zh-CN", onLanguageChange() {} })));

    const chinese = render({});
    assert.match(chinese, /id="sample-heading-0"[^>]*>中文目录<\/h2>/);
    assert.match(chinese, /中文正文/);
    assert.ok(!chinese.includes("English content"));
    assert.match(chinese, /const original = true;/);
    // 正文区不再渲染语言切换按钮与编辑器入口。
    assert.ok(!chinese.includes("aria-pressed"), "正文不应再出现语言切换");
    assert.ok(!chinese.includes("更新中文版") && !chinese.includes("添加中文版"), "正文不应再出现编辑入口");

    const controlsZh = controls({});
    assert.match(controlsZh, /aria-pressed="true"[^>]*>中文版<\/button>/);
    assert.match(controlsZh, /更新中文版/);

    const english = render({ language: "original" });
    assert.match(english, /English content/);
    assert.ok(!english.includes("中文正文"));
    assert.match(controls({ language: "original" }), /aria-pressed="true"[^>]*>英文原文<\/button>/);

    // 没有中文版：正文直接展示原文，不再出现整行「暂无中文版」提示；
    // 缺译用页签行「中文版」上的角标表达，且「中文版」保持可选中（默认就是它）。
    const absent = render({ language: "zh-CN", translation: null });
    assert.ok(!absent.includes("暂无中文版"), "缺译本时正文不应再出现整行提示");
    assert.match(absent, /English content/);
    const absentControls = controls({ language: "zh-CN", state: { translation: null } });
    assert.match(absentControls, /aria-pressed="true"[^>]*>中文版/);
    assert.ok(!/disabled=""[^>]*>中文版/.test(absentControls), "缺译本时中文版仍可选中");
    assert.match(absentControls, /缺少中文版/);
    assert.match(absentControls, /添加中文版/);
    // 有中文版时不显示缺译角标
    assert.ok(!controls({}).includes("缺少中文版"), "有译本时不应出现缺译角标");

    const failed = render({ language: "original", translation: null, error: "读取被拒绝" });
    assert.match(failed, /role="alert"[^>]*>读取被拒绝/);
    assert.match(failed, /English content/);
    assert.match(controls({ state: { error: "读取被拒绝" } }), /重新读取中文版/);
    assert.match(render({ translation: { ...translation, stale: true } }), /英文原文已更新/);
    assert.ok(!render({ language: "original", translation: { ...translation, stale: true } }).includes("当前中文版需要重新核对"));

    // 编辑器：draftOpen 时才渲染；关闭时立即不渲染。
    const editing = render({ draftOpen: true });
    assert.match(editing, /<textarea/);
    assert.match(editing, /保存中文版/);
    const closed = render({ draftOpen: false });
    assert.ok(!closed.includes("<textarea"));

    await i18n.changeLanguage("en");
    assert.match(render({}), /Showing the Chinese translation/);
    assert.deepEqual(Object.keys(translations.zh).sort(), Object.keys(translations.en).sort());
    assert.deepEqual(Object.keys(translations.zh).sort(), Object.keys(translations["zh-TW"]).sort());
  } finally { fs.unlinkSync(modulePath); }
});
