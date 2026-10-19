import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, Copy, Terminal, MessageSquare, FileText } from "lucide-react";
import type { ActivityEvent, ActivityExcerpt } from "../lib/activity";
import { cn } from "../utils";

function Highlight({ text, skillName }: { text: string; skillName: string }) {
  if (!skillName) return text;
  const escaped = skillName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.split(new RegExp(`(${escaped}(?:[/\\\\]SKILL\\.md)?)`, "gi")).map((part, index) =>
    index % 2 ? <mark key={index} className="rounded bg-accent-bg px-0.5 text-accent-dark dark:text-accent-light">{part}</mark> : part
  );
}

const summaryClass = "flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[12px] font-medium text-secondary outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent [&::-webkit-details-marker]:hidden";

/** 上下文默认展开：先看清命中前后的对话，再回到命中内容；原文仍按需展开，避免长 JSON 挤占详情栏。 */
export function ActivityEvidenceCard({ record, excerpt }: { record: ActivityEvent; excerpt: ActivityExcerpt }) {
  const { t } = useTranslation();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  // details 用受控 open：静态渲染与真实交互都以「默认展开」为准，用户手动收起后不会被重渲染弹开。
  const [contextOpen, setContextOpen] = useState(true);
  const focus = excerpt.lines.find(line => line.label === excerpt.focus);
  const evidence = focus?.summary;
  const content = evidence?.content || focus?.text || "";
  const context = excerpt.lines.filter(line => line.summary?.parsed && line.summary.role !== "record");
  const action = evidence?.parsed ? record.kind : "record";
  const position = (label: string) => t(excerpt.lineKind === "part" ? "activity.evidencePart" : "activity.evidenceLine", { position: label.replace(/^part:/, "") });

  async function copy() {
    try { await navigator.clipboard.writeText(content); setCopyState("copied"); }
    catch { setCopyState("error"); }
  }

  return <div className="mt-2 space-y-2.5" data-testid="activity-evidence">
    {/* 顺序：上下文 → 命中内容 → 原文。上下文默认展开，先看命中前后的几行； */}
    <details
      open={contextOpen}
      onToggle={(event) => setContextOpen(event.currentTarget.open)}
      className="group rounded-lg border border-border-subtle"
    >
      <summary className={summaryClass}><ChevronRight className="h-3.5 w-3.5 shrink-0 group-open:rotate-90" />{t("activity.evidenceContext")}</summary>
      <div className="border-t border-border-subtle px-3 pb-3 pt-2">
        <p className="mb-3 text-[11px] leading-4 text-tertiary">{t("activity.evidenceContextHint")}</p>
        {context.length ? <ol className="ml-1.5 space-y-3 border-l border-border-subtle pl-3">
          {context.map(line => {
            const summary = line.summary!;
            const isFocus = line.label === excerpt.focus;
            const Icon = summary.role === "call" ? Terminal : summary.role === "result" ? Check : MessageSquare;
            return <li key={line.label} className="relative min-w-0">
              <span className={cn("absolute -left-[17px] top-1.5 h-2 w-2 rounded-full border border-surface", isFocus ? "bg-accent" : "bg-border-subtle")} />
              <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                <Icon className="h-3 w-3 text-tertiary" />
                <span className="font-medium text-secondary">{t(`activity.evidenceRoles.${summary.role}`)}</span>
                <span className="text-tertiary">{position(line.label)}</span>
                {isFocus && <span className="text-accent-dark dark:text-accent-light">{t("activity.evidenceCurrent")}</span>}
              </div>
              <pre className={cn("max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md px-2 py-1.5 font-mono text-[11px] leading-[18px] text-secondary [overflow-wrap:anywhere]", isFocus ? "bg-accent-bg" : "bg-background")}>
                <Highlight text={summary.content} skillName={record.skillName} />
              </pre>
              {summary.truncated && <p className="mt-1 text-[11px] text-tertiary">{t("activity.evidenceClipped")}</p>}
            </li>;
          })}
        </ol> : <p className="text-[12px] text-tertiary">{t("activity.evidenceNoContext")}</p>}
      </div>
    </details>

    <div className="rounded-lg border border-border-subtle bg-background p-3">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[12px]">
        <dt className="text-tertiary">{t("activity.evidenceAction")}</dt>
        <dd className="text-secondary">{t(`activity.evidenceActions.${action}`)}</dd>
        <dt className="text-tertiary">{t("activity.evidenceTool")}</dt>
        <dd className="break-all font-mono text-secondary">{evidence?.toolName || "—"}</dd>
        <dt className="text-tertiary">{t("activity.skill")}</dt>
        <dd className="break-all font-medium text-primary">{record.skillName}</dd>
      </dl>
      <div className="mt-3 border-t border-border-subtle pt-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <h5 className="text-[12px] font-medium text-secondary">{t("activity.evidenceContent")}</h5>
          <button type="button" onClick={() => void copy()} title={t("activity.evidenceCopy")} aria-label={t("activity.evidenceCopy")}
            className="rounded p-1 text-tertiary outline-none hover:bg-surface-hover hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent">
            {copyState === "copied" ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
        {!evidence?.parsed && <p className="mb-2 text-[11px] text-tertiary">{t("activity.evidenceFallback")}</p>}
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border-subtle bg-surface px-2.5 py-2 font-mono text-[11.5px] leading-5 text-secondary [overflow-wrap:anywhere]">
          <Highlight text={content} skillName={record.skillName} />
        </pre>
        {evidence?.truncated && <p className="mt-1 text-[11px] text-tertiary">{t("activity.evidenceClipped")}</p>}
        <p role={copyState === "error" ? "alert" : "status"} className={cn("text-[11px]", copyState !== "idle" && "mt-1", copyState === "error" ? "text-danger" : "text-accent-dark dark:text-accent-light")}>
          {copyState === "copied" ? t("activity.evidenceCopied") : copyState === "error" ? t("activity.evidenceCopyFailed") : ""}
        </p>
      </div>
    </div>

    <details className="group rounded-lg border border-border-subtle">
      <summary className={summaryClass}><ChevronRight className="h-3.5 w-3.5 shrink-0 group-open:rotate-90" />{t("activity.evidenceRaw")}<FileText className="ml-auto h-3.5 w-3.5 text-muted" /></summary>
      <div className="border-t border-border-subtle">
        <div className="max-h-72 overflow-auto py-1 font-mono text-[11px] leading-[18px]">
          {excerpt.lines.map(line => <div key={line.label} className={cn("flex min-w-0 gap-2 px-2 py-1", line.label === excerpt.focus && "bg-accent-bg")}>
            <span className="w-9 shrink-0 break-all text-right text-tertiary">{line.label.replace(/^part:/, "")}</span>
            <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words text-secondary [overflow-wrap:anywhere]">{line.text}</pre>
          </div>)}
        </div>
        {excerpt.truncated && <p className="px-3 pb-2 text-[11px] text-tertiary">{t("activity.snippetTruncated")}</p>}
      </div>
    </details>
    {excerpt.kind === "zstd" && <p className="text-[11px] text-tertiary">{t("activity.snippetCompressed")}</p>}
    {excerpt.kind === "zcode" && <p className="text-[11px] text-tertiary">{t("activity.snippetDatabase")}</p>}
  </div>;
}
