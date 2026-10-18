import { Fragment, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, FileSearch, FolderSearch, FileText, FolderOpen, RefreshCw } from "lucide-react";
import { cn } from "../utils";
import { openPath } from "../lib/tauri";
import { getActivityExcerpt, toolIconKeys, toolNames, type ActivityEvent, type ActivityExcerpt } from "../lib/activity";
import { TRIGGER_TONE } from "../lib/activityTone";
import { AgentIcon } from "./AgentIcon";

interface Props {
  record: ActivityEvent;
  /** 详情页内嵌时隐藏"打开技能详情"，并压缩次要字段。 */
  compact?: boolean;
  onOpenSkill?: (managedSkillId: string) => void;
  className?: string;
}

/**
 * 单条调用记录的详情。两处复用：调用记录页右栏（完整）与技能详情页签内（compact）。
 * 分区沿用参考图：识别依据 / 记录信息 / 来源文件，末尾给出状态免责说明与技能详情入口。
 */
export function ActivityDetailPanel({ record, compact = false, onOpenSkill, className }: Props) {
  const { t, i18n } = useTranslation();
  const [openError, setOpenError] = useState("");
  // 状态带上记录 id，切换记录时直接由渲染判定为加载中，避免在 effect 里同步清空状态。
  const [excerptState, setExcerptState] = useState<{ id: string; data?: ActivityExcerpt; error?: string } | null>(null);

  useEffect(() => {
    let active = true;
    getActivityExcerpt(record.id).then(data => {
      if (active) setExcerptState({ id: record.id, data });
    }).catch(cause => {
      if (active) setExcerptState({ id: record.id, error: String(cause instanceof Error ? cause.message : cause) });
    });
    return () => { active = false; };
  }, [record.id]);

  const fresh = excerptState?.id === record.id ? excerptState : null;
  const excerpt = fresh?.data ?? null;
  const excerptError = fresh?.error ?? "";
  const excerptLoading = !fresh;
  const snippetRef = useRef<HTMLDivElement | null>(null);
  const focusRef = useRef<HTMLDivElement | null>(null);

  // 长 JSON 行会换行，切换记录后把高亮行滚到靠上的位置，保留少量上下文。
  useEffect(() => {
    const container = snippetRef.current, focus = focusRef.current;
    if (!container || !focus) return;
    const offset = focus.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTop = Math.max(0, offset - 54);
  }, [excerpt]);

  async function revealFile(path: string) {
    setOpenError("");
    try { await openPath(path, true); }
    catch (cause) { setOpenError(String(cause instanceof Error ? cause.message : cause)); }
  }

  // 普通日志跳到精确行；ZCode 的位置是 SQLite 的 part id，定位到数据库文件。
  async function openLog() {
    setOpenError("");
    const line = /^\d+$/.test(record.sourceLine) ? Number(record.sourceLine) : null;
    try { await openPath(record.sourcePath, line === null, line ?? undefined); }
    catch (cause) { setOpenError(String(cause instanceof Error ? cause.message : cause)); }
  }

  const rows: [string, string | null][] = [
    [t("activity.kind"), t(`activity.kinds.${record.kind}`)],
    [t("activity.position"), record.sourceLine],
    [t("activity.session"), record.sessionId],
    [t("activity.call"), record.callId],
    ...(compact ? [] : [[t("activity.project"), record.project]] as [string, string | null][]),
  ];

  const files: [string, string | null][] = [
    [t("activity.skillPath"), record.skillPath],
    [t("activity.sourceFile"), record.sourcePath],
  ];

  // 归属：优先「技能路径可验证」的严格匹配；严格匹配没有时退回「技能名在库里唯一」的兜底，
  // 并在按钮旁标注，避免把弱关联说成确定的关联。
  const skillId = record.managedSkillId ?? record.usageSkillId ?? null;
  const matchedByName = !record.managedSkillId && Boolean(record.usageSkillId);

  return (
    <div className={cn("min-w-0", className)}>
      {/* 记录头部：技能名 + Agent + 触发方式 + 时间 */}
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-bg text-[14px] font-semibold text-accent-dark dark:text-accent-light">
          {record.skillName.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-[14px] font-semibold leading-5 text-primary" title={record.skillName}>{record.skillName}</h3>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1 text-[12px] text-secondary">
              <AgentIcon agentKey={toolIconKeys[record.tool] ?? record.tool} displayName={toolNames[record.tool]} className="h-3.5 w-3.5" />
              {toolNames[record.tool]}
            </span>
            <span className={cn("rounded border px-1.5 py-px text-[10px] leading-4", TRIGGER_TONE[record.trigger])}>
              {t(`activity.triggers.${record.trigger}`)}
            </span>
            <span className="text-[12px] tabular-nums text-tertiary">
              {record.timestamp === null ? t("activity.unknownTime") : new Date(record.timestamp).toLocaleString(i18n.language, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        </div>
      </div>

      {openError && <p role="alert" className="mt-3 border-l-2 border-danger bg-danger-bg px-2 py-1 text-[12px] text-danger">{openError}</p>}

      {/* 识别依据 */}
      <section className="mt-4 border-t border-border-subtle pt-3">
        <h4 className="text-[12px] font-semibold text-secondary">{t("activity.evidence")}</h4>
        <p className="mt-1.5 border-l-2 border-accent bg-accent-bg px-2.5 py-1.5 text-[12px] leading-5 text-secondary">
          {t(`activity.evidenceCodes.${record.evidence}`, { defaultValue: record.evidence })}
        </p>
      </section>

      {/* 原始日志片段：按需读取来源文件，历史库只保存路径与位置 */}
      <section className="mt-4 border-t border-border-subtle pt-3">
        <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1.5">
          <div className="min-w-0">
            <h4 className="text-[12px] font-semibold text-secondary">{t("activity.sourceSnippet")}</h4>
            <p className="mt-0.5 break-all text-[11px] text-tertiary">{t("activity.snippetPosition", { position: record.sourceLine || "—" })}</p>
          </div>
          <button
            type="button"
            onClick={() => void openLog()}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border-subtle bg-surface px-2 py-0.5 text-[11.5px] text-secondary outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ExternalLink className="h-3.5 w-3.5" />{t("activity.openLog")}
          </button>
        </div>

        {excerptLoading && (
          <p role="status" className="mt-2 flex items-center gap-1.5 text-[12px] text-tertiary">
            <RefreshCw className="h-3 w-3 animate-spin" />{t("activity.snippetLoading")}
          </p>
        )}
        {!excerptLoading && excerptError && (
          <p role="alert" className="mt-2 border-l-2 border-danger bg-danger-bg px-2 py-1 text-[12px] text-danger">{excerptError}</p>
        )}
        {!excerptLoading && !excerptError && excerpt && !excerpt.available && (
          <div className="mt-2 rounded-lg border border-dashed border-border-subtle px-2.5 py-2 text-[12px] text-tertiary">
            <p>{t(`activity.snippetReasons.${excerpt.reason}`, { defaultValue: t("activity.snippetReasons.unreadable") })}</p>
            {excerpt.detail && <p className="mt-1 break-all text-[11px] text-muted">{excerpt.detail}</p>}
          </div>
        )}
        {!excerptLoading && !excerptError && excerpt?.available && (
          <>
            <div role="region" aria-label={t("activity.sourceSnippet")} className="mt-1.5 overflow-hidden rounded-lg border border-border-subtle bg-background">
              {excerpt.lineKind === "part" ? (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all px-2.5 py-2 font-mono text-[11px] leading-[18px] text-secondary">{excerpt.lines[0]?.text ?? ""}</pre>
              ) : (
                <div ref={snippetRef} className="max-h-56 overflow-y-auto overflow-x-hidden py-1 font-mono text-[11px] leading-[18px]">
                  {excerpt.lines.map((line, index) => (
                    <div
                      key={`${line.label}:${index}`}
                      ref={line.label === excerpt.focus ? focusRef : undefined}
                      className={cn("flex gap-2 px-2 py-0.5", line.label === excerpt.focus && "bg-accent-bg")}
                    >
                      <span className={cn("w-9 shrink-0 select-none text-right tabular-nums", line.label === excerpt.focus ? "font-medium text-accent-dark dark:text-accent-light" : "text-muted")}>{line.label}</span>
                      <span className="min-w-0 whitespace-pre-wrap break-all text-secondary">{line.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {excerpt.kind === "zstd" && <p className="mt-1 text-[11px] text-tertiary">{t("activity.snippetCompressed")}</p>}
            {excerpt.kind === "zcode" && <p className="mt-1 text-[11px] text-tertiary">{t("activity.snippetDatabase")}</p>}
            {excerpt.truncated && <p className="mt-1 text-[11px] text-tertiary">{t("activity.snippetTruncated")}</p>}
          </>
        )}
      </section>

      {/* 记录信息 */}
      <section className="mt-4 border-t border-border-subtle pt-3">
        <h4 className="text-[12px] font-semibold text-secondary">{t("activity.detailInfo")}</h4>
        <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[12px]">
          {rows.map(([label, value]) => (
            <Fragment key={label}>
              <dt className="whitespace-nowrap text-tertiary">{label}</dt>
              <dd className="min-w-0 break-all text-secondary">{value || "—"}</dd>
            </Fragment>
          ))}
        </dl>
      </section>

      {/* 来源文件 */}
      <section className="mt-4 border-t border-border-subtle pt-3">
        <h4 className="text-[12px] font-semibold text-secondary">{t("activity.sourceFile")}</h4>
        <ul className="mt-1.5 space-y-2">
          {files.map(([label, value]) => (
            <li key={label} className="flex min-w-0 items-start gap-2">
              {label === t("activity.skillPath")
                ? <FileText className="mt-px h-3.5 w-3.5 shrink-0 text-muted" />
                : <FolderOpen className="mt-px h-3.5 w-3.5 shrink-0 text-muted" />}
              <div className="min-w-0">
                <p className="text-[11px] text-tertiary">{label}</p>
                <p className="break-all font-mono text-[11.5px] leading-4 text-secondary">{value || "—"}</p>
              </div>
              {value && (
                <button
                  type="button"
                  onClick={() => void revealFile(value)}
                  className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border border-border-subtle bg-surface px-2 py-0.5 text-[11.5px] text-secondary outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <FolderSearch className="h-3.5 w-3.5" />{t("mySkills.detail.revealInFolder")}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-3 text-[12px] leading-5 text-tertiary">{t("activity.statusNote")}</p>

      {!compact && (skillId && onOpenSkill ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => { if (skillId) onOpenSkill(skillId); }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-dark px-3 py-1.5 text-[12.5px] font-medium text-white outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-accent"
          >
            <FileSearch className="h-3.5 w-3.5" />{t("activity.openSkill")}
          </button>
          {matchedByName && (
            <span className="text-[11.5px] text-tertiary" title={t("activity.openSkillByNameHint")}>
              {t("activity.openSkillByName")}
            </span>
          )}
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-tertiary">{t("activity.unlinked")}</p>
      ))}
    </div>
  );
}
