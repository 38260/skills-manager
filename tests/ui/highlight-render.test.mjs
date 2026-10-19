import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

async function loadModule(entry) {
  const modulePath = path.join(process.cwd(), "tests/ui", `highlight-${path.basename(entry).replace(/\W/g, "")}-${process.pid}.mjs`);
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    packages: "external",
    write: false,
  });
  fs.writeFileSync(modulePath, result.outputFiles[0].text, { flag: "wx" });
  try {
    return await import(pathToFileURL(modulePath).href);
  } finally {
    fs.unlinkSync(modulePath);
  }
}

test("切分：命中一次 / 多次 / 大小写不敏感 / 保留原文大小写", async () => {
  const { splitHighlight } = await loadModule("src/lib/highlight.ts");

  assert.deepEqual(splitHighlight("image-tool", "image"), [
    { text: "image", match: true },
    { text: "-tool", match: false },
  ]);
  assert.deepEqual(splitHighlight("a-b-a", "a"), [
    { text: "a", match: true },
    { text: "-b-", match: false },
    { text: "a", match: true },
  ]);
  // 大小写不敏感匹配，但输出保留原文大小写。
  assert.deepEqual(splitHighlight("Beta Review", "beta"), [
    { text: "Beta", match: true },
    { text: " Review", match: false },
  ]);
  assert.deepEqual(splitHighlight("Beta Review", "REVIEW"), [
    { text: "Beta ", match: false },
    { text: "Review", match: true },
  ]);
  // 中文同样按子串命中。
  assert.deepEqual(splitHighlight("制作宣传海报", "宣传"), [
    { text: "制作", match: false },
    { text: "宣传", match: true },
    { text: "海报", match: false },
  ]);
});

test("切分：空搜索词、空文本、未命中都不产生高亮", async () => {
  const { splitHighlight } = await loadModule("src/lib/highlight.ts");

  assert.equal(splitHighlight("image-tool", ""), null);
  assert.equal(splitHighlight("image-tool", "   "), null);
  assert.equal(splitHighlight("", "image"), null);
  assert.equal(splitHighlight("image-tool", "zzz"), null);
  // 搜索词带首尾空格时按 trim 后的内容匹配。
  assert.deepEqual(splitHighlight("image-tool", "  image  "), [
    { text: "image", match: true },
    { text: "-tool", match: false },
  ]);
});

test("渲染：命中片段包成 <mark>，其余文本原样输出", async () => {
  const { HighlightText } = await loadModule("src/components/HighlightText.tsx");

  const html = renderToStaticMarkup(createElement(HighlightText, { text: "image-tool 制作海报", query: "image" }));
  assert.match(html, /<mark class="[^"]*bg-accent-bg[^"]*">image<\/mark>/);
  assert.match(html, /-tool 制作海报/);
  assert.equal([...html.matchAll(/<mark/g)].length, 1);
});

test("渲染：没有搜索词时不产生任何 <mark>", async () => {
  const { HighlightText } = await loadModule("src/components/HighlightText.tsx");

  const html = renderToStaticMarkup(createElement(HighlightText, { text: "image-tool", query: "  " }));
  assert.equal(html, "image-tool");
  assert.doesNotMatch(html, /<mark/);
});

test("渲染：搜索词里的尖括号按文本转义，不会注入标签", async () => {
  const { HighlightText } = await loadModule("src/components/HighlightText.tsx");

  const html = renderToStaticMarkup(createElement(HighlightText, { text: "a <b> c", query: "<b>" }));
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /&lt;b&gt;/);
  assert.match(html, /<mark class="[^"]*">&lt;b&gt;<\/mark>/);
});
