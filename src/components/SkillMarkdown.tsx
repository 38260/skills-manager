import ReactMarkdown from "react-markdown";
import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import remarkGfm from "remark-gfm";
import { cn } from "../utils";
import { stripMarkdownFrontmatter, headingMatchesTitle } from "../lib/skillMarkdownText";
import { extractHeadings } from "../lib/markdownOutline";

interface SkillMarkdownProps {
  content: string;
  className?: string;
  /** 标题锚点 id 前缀；配合目录跳转使用。 */
  headingIdPrefix?: string;
  /** 隐藏首个 h1（避免与页头技能名重复展示）。 */
  hideFirstHeading?: boolean;
  repeatedTitle?: string;
  variant?: "default" | "detail";
}

export function SkillMarkdown({ content, className, headingIdPrefix, hideFirstHeading = false, repeatedTitle, variant = "default" }: SkillMarkdownProps) {
  const markdown = stripMarkdownFrontmatter(content);
  // 隐藏与页头技能名重复的首个 h1：记录其源行号，渲染时跳过（行号与其余锚点保持一致）。
  const firstH1Line = (() => {
    if (!hideFirstHeading) return null;
    const first = extractHeadings(content).find(heading => heading.level === 1);
    return first && (!repeatedTitle || headingMatchesTitle(first.text, repeatedTitle)) ? first.line : null;
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
    <article className={cn("mx-auto w-full max-w-[860px] text-[14px] leading-[25px] text-secondary", variant === "detail" && "skill-detail-markdown", className)}>
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
            <ul className={cn("mb-4 list-disc pl-5 text-secondary", variant === "detail" ? "space-y-0" : "space-y-1", className)} {...props} />
          ),
          ol: ({ className, ...props }) => (
            <ol className={cn("mb-4 list-decimal pl-5 text-secondary", variant === "detail" ? "space-y-0" : "space-y-1", className)} {...props} />
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
          pre: ({ className, children, ...props }) => variant === "detail" ? <DetailCodeBlock>{children}</DetailCodeBlock> : (
            <pre
              className={cn(
                "mb-4 overflow-x-auto rounded-xl border border-border-subtle bg-background px-4 py-3",
                className
              )}
              {...props}
            >{children}</pre>
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

function DetailCodeBlock({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const code = Children.toArray(children).find(child => isValidElement(child));
  const props = isValidElement<{ children?: ReactNode; className?: string }>(code) ? code.props : {};
  const text = String(props.children ?? "").replace(/\n$/, "");
  const language = props.className?.match(/language-([^\s]+)/)?.[1] || "";
  const names: Record<string, string> = { ts: "TypeScript", typescript: "TypeScript", js: "JavaScript", javascript: "JavaScript", py: "Python", python: "Python", sh: "Shell", bash: "Bash", json: "JSON", css: "CSS", html: "HTML", tsx: "TSX" };
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopyState("copied"); }
    catch { setCopyState("failed"); }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopyState("idle"), 2000);
  }
  const copyLabel = t(`mySkills.detail.${copyState === "copied" ? "copiedCode" : copyState === "failed" ? "copyFailed" : "copyCode"}`);
  return <div className="skill-detail-code overflow-hidden rounded-md border border-border-subtle">
    <div className="flex h-8 items-center justify-between gap-3 border-b border-border-subtle bg-surface-hover px-4 text-[12px] text-muted">
      <span className="min-w-0 truncate"><span className="mr-2 font-mono">{language || "txt"}</span>{names[language] || (language ? "" : t("mySkills.detail.plainText"))}</span>
      <button type="button" onClick={copy} aria-label={copyLabel} className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-tertiary outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-accent">
        {copyState === "copied" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}<span aria-live="polite">{copyLabel}</span>
      </button>
    </div>
    <pre className="skill-detail-code-body m-0 overflow-x-auto bg-background py-2.5 text-[13px] leading-6">
      <code>{text.split("\n").map((line, index) => <span key={index} className="flex min-h-6">
        <span aria-hidden="true" className="w-10 shrink-0 select-none border-r border-border-faint pr-2 text-right text-faint">{index + 1}</span>
        <span className="block flex-1 px-3 text-secondary">{line || " "}</span>
      </span>)}</code>
    </pre>
  </div>;
}
