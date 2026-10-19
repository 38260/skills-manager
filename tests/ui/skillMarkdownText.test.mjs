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

test("目录标题剥掉行内 Markdown 标记，与正文渲染出的标题一致", () => {
  const content = [
    "# Example",
    "## 1. Response — kill *latency*",
    "## 2. 使用 `code` 与 [链接](https://example.com)",
    "## 3. **加粗** 与 ~~删除~~ 与 <br>",
    "## 4. 转义 \\* 号",
  ].join("\n");
  assert.deepEqual(extractHeadings(content, { skipFirst: true }).map(h => h.text), [
    "1. Response — kill latency",
    "2. 使用 code 与 链接",
    "3. 加粗 与 删除 与",
    "4. 转义 * 号",
  ]);
  // 带强调的首个 h1 也要能被识别为"与技能名重复"而跳过
  assert.deepEqual(extractHeadings("# **UI Design**\n## 方法", { skipFirst: true, repeatedTitle: "ui-design" }), [
    { text: "方法", level: 2, line: 1 },
  ]);
});

test("只隐藏与技能名称重复的首个 h1，正文标题和目录行号完整保留", () => {
  assert.deepEqual(extractHeadings("# UI Design\n## 场景", { skipFirst: true, repeatedTitle: "ui-design" }), [{ text: "场景", level: 2, line: 1 }]);
  assert.deepEqual(extractHeadings("# 适用场景\n## 方法", { skipFirst: true, repeatedTitle: "ui-design" }), [{ text: "适用场景", level: 1, line: 0 }, { text: "方法", level: 2, line: 1 }]);
  assert.deepEqual(extractHeadings("~~~~md\n# 代码内标题\n~~~\n# 仍在代码中\n~~~~\n# UI Design\n## 方法", { skipFirst: true, repeatedTitle: "ui-design" }), [{ text: "方法", level: 2, line: 6 }]);
});
