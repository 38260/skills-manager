import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../utils";
import { stripMarkdownFrontmatter } from "../lib/skillMarkdownText";

interface SkillMarkdownProps {
  content: string;
  className?: string;
  /** 标题锚点 id 前缀；配合目录跳转使用。 */
  headingIdPrefix?: string;
  /** 隐藏首个 h1（避免与页头技能名重复展示）。 */
  hideFirstHeading?: boolean;
}

export function SkillMarkdown({ content, className, headingIdPrefix, hideFirstHeading = false }: SkillMarkdownProps) {
  const markdown = stripMarkdownFrontmatter(content);
  // 隐藏与页头技能名重复的首个 h1：记录其源行号，渲染时跳过（行号与其余锚点保持一致）。
  const firstH1Line = (() => {
    if (!hideFirstHeading) return null;
    const lines = markdown.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      if (/^```/.test(lines[index])) break;
      if (/^#\s+/.test(lines[index])) return index;
    }
    return null;
  })();
  const headingId = (node: unknown) => {
    if (!headingIdPrefix) return undefined;
    const position = (node as { position?: { start?: { line?: number } } } | null | undefined)?.position;
    if (!position?.start?.line) return undefined;
    return `${headingIdPrefix}-heading-${position.start.line - 1}`;
  };
  const isHiddenFirstH1 = (node: unknown) => {
    if (firstH1Line === null) return false;
    const position = (node as { position?: { start?: { line?: number } } } | null | undefined)?.position;
    return position?.start?.line === firstH1Line + 1;
  };

  return (
    <article className={cn("mx-auto w-full max-w-[860px] text-[14px] leading-[25px] text-secondary", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node, ...props }) => (isHiddenFirstH1(node) ? null : (
            <h1 id={headingId(node)} className={cn("mb-4 text-[26px] font-semibold leading-tight text-primary")} {...props} />
          )),
          h2: ({ node, ...props }) => (
            <h2 id={headingId(node)} className={cn("mb-3 mt-8 text-[19px] font-semibold leading-tight text-primary")} {...props} />
          ),
          h3: ({ node, ...props }) => (
            <h3 id={headingId(node)} className={cn("mb-2 mt-6 text-[15.5px] font-semibold leading-tight text-primary")} {...props} />
          ),
          p: ({ className, ...props }) => (
            <p className={cn("mb-4 text-[14px] leading-[25px] text-secondary", className)} {...props} />
          ),
          a: ({ className, href, ...props }) => {
            const dangerous = /^(javascript|vbscript|data):/i;
            const safeHref = href && !dangerous.test(href.trim()) ? href : undefined;
            return (
              <a
                className={cn("text-accent-light underline decoration-accent-border underline-offset-4", className)}
                href={safeHref}
                target="_blank"
                rel="noreferrer"
                {...props}
              />
            );
          },
          ul: ({ className, ...props }) => (
            <ul className={cn("mb-4 list-disc space-y-1 pl-5 text-secondary", className)} {...props} />
          ),
          ol: ({ className, ...props }) => (
            <ol className={cn("mb-4 list-decimal space-y-1 pl-5 text-secondary", className)} {...props} />
          ),
          li: ({ className, ...props }) => (
            <li className={cn("pl-1 marker:text-muted", className)} {...props} />
          ),
          blockquote: ({ className, ...props }) => (
            <blockquote
              className={cn(
                "mb-4 border-l-2 border-accent-border bg-surface/70 px-4 py-2 text-tertiary italic",
                className
              )}
              {...props}
            />
          ),
          hr: ({ className, ...props }) => (
            <hr className={cn("my-6 border-border-subtle", className)} {...props} />
          ),
          code: ({ className, children, ...props }) => {
            const isBlock = String(className || "").includes("language-");
            if (isBlock) {
              return (
                <code className={cn("block text-[13px] leading-6 text-secondary", className)} {...props}>
                  {children}
                </code>
              );
            }

            return (
              <code
                className={cn(
                  "rounded bg-surface-hover px-1.5 py-0.5 font-mono text-[13px] text-accent-light",
                  className
                )}
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ className, ...props }) => (
            <pre
              className={cn(
                "mb-4 overflow-x-auto rounded-xl border border-border-subtle bg-background px-4 py-3",
                className
              )}
              {...props}
            />
          ),
          table: ({ className, ...props }) => (
            <div className="mb-4 overflow-x-auto rounded-xl border border-border-subtle">
              <table className={cn("min-w-full border-collapse text-left text-[13px]", className)} {...props} />
            </div>
          ),
          thead: ({ className, ...props }) => (
            <thead className={cn("bg-surface-hover text-primary", className)} {...props} />
          ),
          th: ({ className, ...props }) => (
            <th className={cn("border-b border-border-subtle px-3 py-2 font-medium", className)} {...props} />
          ),
          td: ({ className, ...props }) => (
            <td className={cn("border-b border-border-subtle px-3 py-2 text-secondary", className)} {...props} />
          ),
          img: ({ className, ...props }) => (
            <img className={cn("max-w-full rounded-lg", className)} loading="lazy" {...props} />
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
