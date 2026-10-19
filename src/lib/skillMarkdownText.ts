// Markdown 前置元数据与首个标题的裁剪逻辑：渲染（SkillMarkdown）与目录提取共用同一口径。
export function stripMarkdownFrontmatter(content: string) {
  return content.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)\s*/, "");
}

// 技能标识常用连字符，文档标题常用空格；只归一化大小写和这些分隔符。
export function headingMatchesTitle(heading: string, title: string): boolean {
  const normalize = (value: string) => stripInlineMarkdown(value).toLowerCase().replace(/[-_\s]+/g, " ");
  return normalize(heading) === normalize(title);
}

// 行内 Markdown 标记（强调、行内代码、链接、图片、转义、行内 HTML）在正文渲染时会被吃掉。
// 目录条目取自原始标题行，必须同样剥掉，否则目录里会出现 *xxx*、`code` 这类裸标记，
// 看起来与正文标题不是同一条，也会让"目录是否等于正文"的校验对不上。
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!>~])/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}

/** 返回去掉首个 h1（若存在）后的正文；目录与渲染在"隐藏首个标题"时使用。 */
export function stripFirstHeading(content: string): string {
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    if (/^```/.test(lines[index])) break;
    if (/^#\s+/.test(lines[index])) {
      lines.splice(index, 1);
      return lines.join("\n");
    }
  }
  return content;
}
