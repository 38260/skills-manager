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

test("发现目录面板可访问地展示路径、状态、移除入口与手动路径输入", async () => {
  const modulePath = path.join(process.cwd(), "tests/ui", `discovery-dirs-render-${process.pid}.mjs`);
  const result = await build({ entryPoints: ["src/components/DiscoveryDirsPanel.tsx"], bundle: true, platform: "node", format: "esm", jsx: "automatic", packages: "external", write: false });
  fs.writeFileSync(modulePath, result.outputFiles[0].text, { flag: "wx" });
  try {
    const { DiscoveryDirsPanel } = await import(pathToFileURL(modulePath).href);
    const translations = JSON.parse(fs.readFileSync("src/i18n/zh.json", "utf8"));
    const i18n = createInstance();
    await i18n.init({ lng: "zh", resources: { zh: { translation: translations } }, interpolation: { escapeValue: false } });
    const html = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n }, createElement(DiscoveryDirsPanel, {
        dirs: [
          { path: "D:/skills", exists: true, readable: true, is_dir: true },
          { path: "D:/gone", exists: false, readable: false, is_dir: false },
        ],
        loading: false,
        busy: false,
        onAdd: async () => true,
        onRemove: async () => {},
        onBrowse: async () => null,
      }))
    );
    assert.match(html, /aria-labelledby="discovery-dirs-title"/);
    assert.match(html, /id="discovery-dirs-title"/);
    assert.match(html, /<label for="discovery-dir-input"/);
    assert.match(html, /id="discovery-dir-input"/);
    assert.match(html, /D:\/skills/);
    assert.match(html, /D:\/gone/);
    assert.match(html, /可用/);
    assert.match(html, /不存在/);
    assert.match(html, /aria-label="移除发现目录 D:\/skills"/);
    assert.match(html, /type="submit"/);
    assert.equal([...html.matchAll(/id="discovery-dir-input"/g)].length, 1);
  } finally {
    fs.unlinkSync(modulePath);
  }
});
