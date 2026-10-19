import { stripMarkdownFrontmatter, stripInlineMarkdown, headingMatchesTitle } from "./skillMarkdownText.ts";

export interface MarkdownHeading { text: string; level: 1 | 2 | 3; line: number }

// 提取 h1-h3 标题用于目录；line 为正文中该行的 0 基行号，与渲染端 position.start.line-1 对齐。
// skipFirst 为 true 时跳过首个 h1（页头已展示技能名），但不移动其余标题的行号。
export function extractHeadings(content: string, { skipFirst = false, repeatedTitle }: { skipFirst?: boolean; repeatedTitle?: string } = {}): MarkdownHeading[] {
  const markdown = stripMarkdownFrontmatter(content);
  const lines = markdown.split(/\r?\n/);
  const headings: MarkdownHeading[] = [];
  let fence: string | null = null;
  let seenH1 = false;
  lines.forEach((line, index) => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      return;
    }
    if (marker) { fence = marker[1]; return; }
    const match = /^ {0,3}(#{1,3})\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
    if (!match) return;
    // 目录展示的是渲染后的标题文本：先剥掉行内 Markdown 标记，再判断是否与技能名重复。
    const text = stripInlineMarkdown(match[2]);
    if (match[1].length === 1 && !seenH1) {
      seenH1 = true;
      if (skipFirst && (!repeatedTitle || headingMatchesTitle(text, repeatedTitle))) return;
    }
    headings.push({ text, level: match[1].length as 1 | 2 | 3, line: index });
  });
  return headings;
}
