// Markdown 前置元数据与首个标题的裁剪逻辑：渲染（SkillMarkdown）与目录提取共用同一口径。
export function stripMarkdownFrontmatter(content: string) {
  return content.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)\s*/, "");
}

// 技能标识常用连字符，文档标题常用空格；只归一化大小写和这些分隔符。
export function headingMatchesTitle(heading: string, title: string): boolean {
  const normalize = (value: string) => value.trim().toLowerCase().replace(/[-_\s]+/g, " ");
  return normalize(heading) === normalize(title);
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
