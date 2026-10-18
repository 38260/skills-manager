import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { getDesktopCapabilities } from "../../src/lib/desktopCapabilities.ts";

test("实际设置页面只显示宿主可执行的操作并保留启动自动更新开关", async () => {
  const translations = JSON.parse(fs.readFileSync("src/i18n/zh.json", "utf8"));
  const i18n = createInstance();
  await i18n.init({ lng: "zh", resources: { zh: { translation: translations } } });

  for (const runtime of ["browser", "electron", "tauri"]) {
    const modulePath = path.join(process.cwd(), "tests/ui", `desktop-settings-${process.pid}-${runtime}.mjs`);
    const capabilities = getDesktopCapabilities(runtime, "Windows NT 10.0");
    const mocks = {
      "../lib/desktop": `export const desktopCapabilities = ${JSON.stringify(capabilities)}; export const openDirectory = async () => null; export const confirmDialog = async () => false; export const openExternal = async () => {};`,
      "../context/AppContext": "export const useApp = () => ({ tools: [], refreshTools: async () => {}, openHelp: () => {}, appUpdate: { has_update: true, latest_version: '2.0.0', release_url: 'https://example.invalid/release' }, refreshAppUpdate: async () => {} });",
      "../context/ThemeContext": "export const useThemeContext = () => ({ theme: 'light', setTheme: () => {} });",
    };
    const result = await build({
      entryPoints: ["src/views/Settings.tsx"], bundle: true, platform: "node", format: "esm", jsx: "automatic", packages: "external", write: false,
      plugins: [{
        name: "settings-runtime-fixture",
        setup(builder) {
          builder.onResolve({ filter: /^\.\.\/(lib\/desktop|context\/(AppContext|ThemeContext))$/ }, args => ({ path: args.path, namespace: "settings-fixture" }));
          builder.onLoad({ filter: /.*/, namespace: "settings-fixture" }, args => ({ contents: mocks[args.path], loader: "js" }));
        },
      }],
    });
    fs.writeFileSync(modulePath, result.outputFiles[0].text, { flag: "wx" });
    try {
      const { Settings } = await import(pathToFileURL(modulePath).href);
      const markup = renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(MemoryRouter, null, createElement(Settings))));
      const native = runtime === "tauri";
      for (const label of [translations.settings.closeAction_ask, translations.settings.autoUpdate.interval1h, translations.settings.installUpdate]) {
        assert.equal(markup.includes(`>${label}</button>`), native, `${runtime}: ${label}`);
      }
      assert.equal(markup.includes(`placeholder="${translations.settings.proxyUrlPlaceholder}"`), native, `${runtime}: proxy editor`);
      assert.equal(markup.includes(`aria-label="${translations.settings.trayIcon_on}"`), native, `${runtime}: tray switch`);
      assert.ok(markup.includes(translations.settings.autoUpdate.applyLabel), `${runtime}: working startup auto-update remains available`);
      if (!native) assert.ok(markup.includes(translations.settings[runtime === "electron" ? "desktopCloseUnavailable" : "browserCloseUnavailable"]), `${runtime}: unsupported settings explain the actual host behavior`);
    } finally {
      fs.unlinkSync(modulePath);
    }
  }
});
