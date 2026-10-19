export interface HighlightSegment {
  text: string;
  /** 是否与搜索词命中（渲染时包成 <mark>）。 */
  match: boolean;
}

/**
 * 把一段文本按搜索词切成「命中 / 未命中」片段，供搜索结果高亮渲染。
 * - 大小写不敏感，但保留原文大小写；
 * - 搜索词为空、或文本里没有命中时返回 null（渲染方直接输出原文，不产生多余节点）；
 * - 一段文本里出现多次时全部切出来。
 */
export function splitHighlight(text: string, query: string): HighlightSegment[] | null {
  const needle = query.trim().toLowerCase();
  if (!needle || !text) return null;
  const haystack = text.toLowerCase();
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (;;) {
    const index = haystack.indexOf(needle, cursor);
    if (index < 0) break;
    if (index > cursor) segments.push({ text: text.slice(cursor, index), match: false });
    segments.push({ text: text.slice(index, index + needle.length), match: true });
    cursor = index + needle.length;
  }
  if (segments.length === 0) return null;
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}
