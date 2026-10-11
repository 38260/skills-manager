import { stripMarkdownFrontmatter } from "./skillMarkdownText";

export interface MarkdownHeading { text: string; level: 1 | 2 | 3; line: number }

// 提取 h1-h3 标题用于目录；line 为正文中该行的 0 基行号，与渲染端 position.start.line-1 对齐。
// skipFirst 为 true 时跳过首个 h1（页头已展示技能名），但不移动其余标题的行号。
export function extractHeadings(content: string, { skipFirst = false } = {}): MarkdownHeading[] {
  const markdown = stripMarkdownFrontmatter(content);
  const lines = markdown.split(/\r?\n/);
  let firstH1Line: number | null = null;
  if (skipFirst) {
    for (let index = 0; index < lines.length; index++) {
      if (/^```/.test(lines[index])) break;
      if (/^#\s+/.test(lines[index])) { firstH1Line = index; break; }
    }
  }
  const headings: MarkdownHeading[] = [];
  let inCodeBlock = false;
  lines.forEach((line, index) => {
    if (line.startsWith("```")) { inCodeBlock = !inCodeBlock; return; }
    if (inCodeBlock) return;
    if (index === firstH1Line) return;
    const match = /^(#{1,3})\s+(.+?)\s*#*$/.exec(line);
    if (!match) return;
    headings.push({ text: match[2], level: match[1].length as 1 | 2 | 3, line: index });
  });
  return headings;
}
