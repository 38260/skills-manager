import test from "node:test";
import assert from "node:assert/strict";
import { stripMarkdownFrontmatter } from "../../src/lib/skillMarkdownText.ts";
import { extractHeadings } from "../../src/lib/markdownOutline.ts";

test("Markdown 正文和目录兼容 LF、CRLF、BOM 及末尾元数据分隔符", () => {
  for (const newline of ["\n", "\r\n"]) {
    for (const bom of ["", "\uFEFF"]) {
      const content = `${bom}---${newline}name: example${newline}---${newline}# Example${newline}## 使用方法${newline}正文`;
      assert.equal(stripMarkdownFrontmatter(content), `# Example${newline}## 使用方法${newline}正文`);
      assert.deepEqual(extractHeadings(content, { skipFirst: true }), [{ text: "使用方法", level: 2, line: 1 }]);
    }
  }
  assert.equal(stripMarkdownFrontmatter("---\nname: example\n---"), "");
});

test("没有或未闭合的前置元数据保留正文与代码缩进", () => {
  for (const content of ["    indented code\n", "---\n未闭合正文", "# Example\n---\n正文"]) {
    assert.equal(stripMarkdownFrontmatter(content), content);
  }
});
