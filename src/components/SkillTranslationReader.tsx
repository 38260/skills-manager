import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, RefreshCw } from "lucide-react";
import { cn } from "../utils";
import { SkillMarkdown } from "./SkillMarkdown";
import { documentSourceLanguage, saveSkillTranslation, type DocumentLanguage, type SkillTranslation } from "../lib/skillTranslation";
import { getErrorMessage } from "../lib/error";

export interface SkillTranslationState {
  translation: SkillTranslation | null;
  loading: boolean;
  error: string;
  reload: () => void;
  accept: (translation: SkillTranslation) => void;
}

const CONTROL = "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40";

/** 页签行的「编辑 / 添加中文版」按钮通过这个事件通知详情面板打开编辑器。 */
export const TRANSLATION_EDITOR_EVENT = "skills-manager:open-translation-editor";

/**
 * 文档语言切换 + 编辑入口。原先和正文一起放在文档顶部，现在挂到页签行最右侧，
 * 与「文档 / 来源与差异 / 调用记录」同一行，正文区只留内容本身。
 *
 * 没有中文版时仍然默认选中「中文版」——正文本来就只有一份原文，直接展示它。
 * 「还没有译本」不再占用任何视觉位置：界面上不显示角标，说明只进 `title` 与 `sr-only`；
 * 而且只有正文本身是英文的技能才算缺译，中文原文的技能不需要中文版，连提示都不该有。
 */
export function SkillTranslationControls({ skillId, original, state, language, disabled, onLanguageChange }: {
  skillId: string;
  /** 正文原文；用来判断这个技能是否真的需要中文译本。 */
  original: string;
  state: SkillTranslationState;
  language: DocumentLanguage;
  /** 非文档页签时禁用编辑入口，避免在来源/记录页误开编辑器。 */
  disabled?: boolean;
  onLanguageChange: (language: DocumentLanguage) => void;
}) {
  const { t } = useTranslation();
  const { translation, loading, error } = state;
  const hasTranslation = !!translation?.content;
  const missing = !loading && !error && !hasTranslation && documentSourceLanguage(original) === "en";
  return (
    <div className="flex shrink-0 items-center gap-1">
      <div role="group" aria-label={t("skillTranslation.language")} className="inline-flex rounded-lg bg-surface-hover p-0.5">
        {(["zh-CN", "original"] as const).map(value => <button
          key={value} type="button" aria-pressed={language === value}
          title={value === "zh-CN" && missing ? t("skillTranslation.missing") : undefined}
          aria-describedby={value === "zh-CN" && missing ? `${skillId}-translation-missing` : undefined}
          onClick={() => onLanguageChange(value)}
          className={cn(
            "relative inline-flex items-center rounded-md px-2.5 py-1 text-[12.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40",
            language === value ? "bg-surface font-medium text-accent shadow-sm" : "text-tertiary hover:text-secondary"
          )}
        >{t(value === "zh-CN" ? "skillTranslation.chinese" : "skillTranslation.original")}
          {/* 缺译角标：不撑宽按钮太多，靠 title / sr-only 给出完整说明 */}
          {value === "zh-CN" && missing && (
            <span id={`${skillId}-translation-missing`} className="sr-only">{t("skillTranslation.missingShort")}</span>
          )}
        </button>)}
      </div>
      <button type="button" onClick={state.reload} disabled={loading || disabled} className={cn(CONTROL, "px-2 py-1 text-muted hover:bg-surface-hover")} title={t("skillTranslation.retry")} aria-label={t("skillTranslation.retry")}>
        <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
      </button>
      {/* 编辑入口只负责开合：编辑器仍渲染在正文顶部，按钮留在页签行。 */}
      <button
        type="button"
        disabled={loading || disabled || !!error || !translation}
        onClick={() => document.dispatchEvent(new CustomEvent(TRANSLATION_EDITOR_EVENT, { detail: { skillId } }))}
        className={cn(CONTROL, "border border-border-subtle py-1 text-secondary hover:bg-surface-hover")}
        title={hasTranslation ? undefined : t("skillTranslation.add")}
      ><Pencil className="h-3.5 w-3.5" />
        {/* 有无译本决定文案（添加 / 更新），与是否提示缺译是两件事 */}
        {t(hasTranslation ? "skillTranslation.edit" : "skillTranslation.add")}
      </button>
    </div>
  );
}

interface Props extends SkillTranslationState {
  skillId: string;
  original: string;
  language: DocumentLanguage;
  /** 编辑器开合由页签行的按钮控制；这里只负责渲染。 */
  draftOpen: boolean;
  onDraftClose: () => void;
  headingIdPrefix: string;
  repeatedTitle: string;
  onLanguageChange: (language: DocumentLanguage) => void;
  onSaved: (translation: SkillTranslation) => void;
}

export function SkillTranslationReader({ skillId, original, translation, loading, error, language, draftOpen, onDraftClose, headingIdPrefix, repeatedTitle, onLanguageChange, onSaved }: Props) {
  const { t } = useTranslation();
  const editorId = useId();
  const [draftContent, setDraftContent] = useState<{ content: string; sourceHash: string; revision: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const content = language === "zh-CN" && translation?.content ? translation.content : original;
  const button = "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40";

  // 打开编辑器时以当前译文为草稿；原文版本与修订号一起冻结，保存时由后端校验。
  // 用渲染期按需初始化（不在 effect 里 setState），关闭编辑器时草稿随之丢掉，下次打开重新取。
  if (draftOpen && !draftContent && translation) {
    setDraftContent({ content: translation.content ?? "", sourceHash: translation.source_hash, revision: translation.revision });
  }
  // 渲染期切换：关闭时立即不渲染编辑器，但保留失败输入一段时间以便提示仍在（重新打开会重新取）。
  const draft = draftOpen ? draftContent : null;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || saving) return;
    setSaving(true); setSaveError("");
    try {
      const next = await saveSkillTranslation(skillId, draft.content, draft.sourceHash, draft.revision);
      onSaved(next);
      onLanguageChange("zh-CN");
      setDraftContent(null); setSaved(true); onDraftClose();
    } catch (cause) { setSaveError(getErrorMessage(cause, t("skillTranslation.saveFailed"))); }
    finally { setSaving(false); }
  }

  // 只有真的有译文内容时才算「在看中文」；缺译本时虽然按钮选中中文版，正文其实是原文。
  const showingTranslation = language === "zh-CN" && !!translation?.content;
  const statusText = loading
    ? t("skillTranslation.loading")
    : error
      ? t("skillTranslation.loadFailed")
      : translation?.content
        ? t(showingTranslation ? "skillTranslation.readingChinese" : "skillTranslation.readingOriginal")
        : null;

  return <div className="w-full">
    {(statusText || error || (language === "zh-CN" && translation?.stale) || saved) && <div className="mb-5 space-y-2">
      {statusText && <p className="text-[12px] text-muted" aria-live="polite">{statusText}</p>}
      {error && <p role="alert" className="break-words text-[12.5px] text-danger">{error}</p>}
      {language === "zh-CN" && translation?.stale && <p role="status" className="rounded-md border border-border-subtle bg-surface-hover px-3 py-2 text-[12.5px] text-secondary">{t("skillTranslation.stale")}</p>}
      {saved && <p role="status" className="text-[12px] text-accent">{t("skillTranslation.saved")}</p>}
    </div>}
    {draft && <form onSubmit={save} className="mb-6 space-y-3 rounded-lg border border-border-subtle bg-surface p-4">
      <label htmlFor={editorId} className="block text-[13px] font-medium text-primary">{t("skillTranslation.editorLabel")}</label>
      <p id={`${editorId}-hint`} className="text-[12.5px] leading-5 text-tertiary">{t("skillTranslation.editorHint")}</p>
      <textarea id={editorId} aria-describedby={`${editorId}-hint`} value={draft.content} disabled={saving} rows={14}
        onChange={event => setDraftContent({ ...draft, content: event.target.value })} placeholder={t("skillTranslation.placeholder")}
        className="w-full resize-y rounded-md border border-border-subtle bg-background px-3 py-2 font-mono text-[13px] leading-6 text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-60" />
      {saveError && <div role="alert" className="text-[12.5px] text-danger"><p>{saveError}</p><p className="mt-1">{t("skillTranslation.sourceChanged")}</p></div>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={saving || !draft.content.trim()} className={cn(button, "bg-accent text-white hover:opacity-90")}>{t(saving ? "skillTranslation.saving" : "skillTranslation.save")}</button>
        <button type="button" disabled={saving} onClick={() => { setDraftContent(null); setSaveError(""); onDraftClose(); }} className={cn(button, "border border-border-subtle text-secondary hover:bg-surface-hover")}>{t("skillTranslation.cancel")}</button>
      </div>
    </form>}
    <SkillMarkdown content={content} headingIdPrefix={headingIdPrefix} hideFirstHeading repeatedTitle={repeatedTitle} variant="detail" />
  </div>;
}
