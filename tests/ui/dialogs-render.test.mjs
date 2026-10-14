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

test("确认框标题与说明关联到 dialog，取消与确认不会提交宿主表单", async () => {
  const modulePath = path.join(process.cwd(), "tests/ui", `dialogs-render-${process.pid}.mjs`);
  const result = await build({ entryPoints: ["src/components/ConfirmDialog.tsx"], bundle: true, platform: "node", format: "esm", jsx: "automatic", packages: "external", write: false });
  fs.writeFileSync(modulePath, result.outputFiles[0].text, { flag: "wx" });
  try {
    const { ConfirmDialog } = await import(pathToFileURL(modulePath).href);
    const i18n = createInstance();
    await i18n.init({ lng: "zh", resources: { zh: { translation: { common: { close: "关闭", cancel: "取消", delete: "删除" } } } } });
    const render = (open) => renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(ConfirmDialog, { open, title: "删除技能", message: "确认范围", onClose() {}, onConfirm: async () => {} })));
    const html = render(true);
    assert.match(html, /role="dialog" aria-modal="true"/);
    const heading = html.match(/aria-labelledby="([^"]+)"/)[1];
    const description = html.match(/aria-describedby="([^"]+)"/)[1];
    assert.ok(html.includes(`id="${heading}"`));
    assert.ok(html.includes(`id="${description}"`));
    assert.equal([...html.matchAll(/<button type="button"/g)].length, 3);
    assert.match(html, /tabindex="-1"/);
    assert.equal(render(false), "");
  } finally { fs.unlinkSync(modulePath); }
});
