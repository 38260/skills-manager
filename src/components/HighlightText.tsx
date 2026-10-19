import { Fragment } from "react";
import { cn } from "../utils";
import { splitHighlight } from "../lib/highlight";

interface Props {
  /** 原文；未命中时原样输出。 */
  text: string;
  /** 搜索词，空串表示当前没有搜索，不做任何包裹。 */
  query: string;
  className?: string;
}

/**
 * 搜索结果高亮：把命中的片段包进 <mark>，其余部分原样输出。
 * 只切分不转义——React 本身会做文本转义，所以搜索词里带尖括号也不会注入。
 */
export function HighlightText({ text, query, className }: Props) {
  const segments = splitHighlight(text, query);
  if (!segments) return <>{text}</>;
  return (
    <>
      {segments.map((segment, index) => (
        segment.match
          ? <mark key={index} className={cn("rounded-[3px] bg-accent-bg px-0.5 text-accent-dark dark:text-accent-light", className)}>{segment.text}</mark>
          : <Fragment key={index}>{segment.text}</Fragment>
      ))}
    </>
  );
}
