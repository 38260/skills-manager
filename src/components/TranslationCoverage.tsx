import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../utils";
import type { ManagedSkill } from "../lib/tauri";
import type { TranslationCoverage } from "../lib/skillTranslation";

interface Props {
  /** 后端统计结果；未返回前为 null，界面上不能把「还没读到」显示成 0。 */
  coverage: TranslationCoverage | null;
  loading: boolean;
  error: string;
  /** 用中央库的技能列表把统计里的 id 还原成可点击条目（含显示名与别名口径）。 */
  skills: ManagedSkill[];
  onOpenSkill: (skillId: string) => void;
}

function pickSkills(entries: { id: string }[] | undefined, skills: ManagedSkill[]): ManagedSkill[] {
  if (!entries?.length) return [];
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  return entries.map((entry) => byId.get(entry.id)).filter((skill): skill is ManagedSkill => !!skill);
}

/**
 * 工作台第四张统计卡：还有多少个英文技能的正文没有中文译本。
 * 分母只算「正文是英文」的技能，中文原文的技能不需要译本，避免把 32 个中文技能算成待办。
 */
export function TranslationCoverageCard({ coverage, loading, error, skills, onOpenSkill }: Props) {
  const { t } = useTranslation();
  const ready = !loading && !error && coverage !== null;
  const english = coverage?.english ?? 0;
  const translated = coverage?.translated ?? 0;
  const missing = coverage?.missing ?? 0;
  const stale = coverage?.stale ?? 0;
  const percent = english === 0 ? 100 : Math.round((translated / english) * 1000) / 10;
  const missingSkills = useMemo(() => pickSkills(coverage?.missing_skills, skills), [coverage, skills]);

  return (
    <section className="app-panel px-4 py-3.5">
      <p className="app-section-title">{t("dashboard.translationCoverage")}</p>
      <h3 className="mt-1 flex items-baseline gap-1.5 text-[30px] font-semibold leading-9 tabular-nums text-primary">
        {ready ? missing : "—"}
        <span className="text-[13px] font-normal text-muted">{t("dashboard.translationMissingUnit")}</span>
      </h3>

      <div className="mt-2.5 flex items-center gap-2">
        <div
          role="progressbar"
          aria-label={t("dashboard.translationCoverage")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={ready ? percent : 0}
          className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-active"
        >
          <div className="h-full rounded-full bg-accent-light" style={{ width: `${ready ? percent : 0}%` }} />
        </div>
        <span className="shrink-0 text-[12px] tabular-nums text-tertiary">{ready ? `${percent}%` : "—"}</span>
      </div>

      {error ? (
        <p className="mt-2 text-[12px] text-danger" title={error}>{t("dashboard.translationError")}</p>
      ) : loading || !coverage ? (
        <p className="mt-2 text-[12px] text-tertiary">{t("dashboard.translationLoading")}</p>
      ) : english === 0 ? (
        <p className="mt-2 text-[12px] text-tertiary">{t("dashboard.translationNoEnglish")}</p>
      ) : missing === 0 ? (
        <p className="mt-2 flex items-center gap-1 text-[12px] text-tertiary">
          <Check className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
          {t("dashboard.translationAllDone", { count: english })}
        </p>
      ) : (
        <MissingTranslationList skills={missingSkills} count={missing} onOpenSkill={onOpenSkill} />
      )}

      {ready && stale > 0 && (
        <p className="mt-1.5 text-[12px] text-amber-600 dark:text-amber-400">
          {t("dashboard.translationStale", { count: stale })}
        </p>
      )}
    </section>
  );
}

interface ListProps {
  skills: ManagedSkill[];
  count: number;
  onOpenSkill: (skillId: string) => void;
}

/** 「N 个待译」的展开入口：点开直接列出是哪些技能，点行复用全局技能详情弹层。 */
function MissingTranslationList({ skills, count, onOpenSkill }: ListProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 展开的面板先消费 Escape，避免同时触发外层（详情弹层/多选）的关闭。
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  if (skills.length === 0) {
    return <p className="mt-2 text-[12px] text-tertiary">{t("dashboard.translationMissing", { count })}</p>;
  }

  return (
    <div ref={containerRef} className="relative mt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "inline-flex items-center gap-1 rounded text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
          open ? "text-secondary" : "text-tertiary hover:text-secondary"
        )}
      >
        {t("dashboard.translationListTrigger", { count })}
        <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open && <TranslationCoveragePanel id={panelId} skills={skills} onOpenSkill={onOpenSkill} onClose={() => setOpen(false)} />}
    </div>
  );
}

interface PanelProps {
  id: string;
  skills: ManagedSkill[];
  onOpenSkill: (skillId: string) => void;
  onClose: () => void;
}

/** 名单本体：单独导出，便于按名称/顺序做无 DOM 的渲染断言。 */
export function TranslationCoveragePanel({ id, skills, onOpenSkill, onClose }: PanelProps) {
  const { t } = useTranslation();
  return (
    <div
      id={id}
      className="absolute left-0 top-full z-30 mt-1.5 w-[248px] rounded-lg border border-border bg-surface p-1 shadow-lg"
    >
      <p className="px-2 pb-1 pt-1 text-[11px] font-medium text-tertiary">{t("dashboard.translationListTitle")}</p>
      <ul className="max-h-[212px] overflow-y-auto">
        {skills.map((skill) => {
          const name = skill.display_name || skill.name;
          return (
            <li key={skill.id}>
              <button
                type="button"
                title={name}
                onClick={() => {
                  onClose();
                  onOpenSkill(skill.id);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover"
              >
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-secondary">{name}</span>
                <ArrowRight className="h-3 w-3 shrink-0 text-faint" />
              </button>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-border-subtle px-2 pb-1 pt-1.5 text-[11px] leading-4 text-faint">
        {t("dashboard.translationListHint")}
      </p>
    </div>
  );
}
