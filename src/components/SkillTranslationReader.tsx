import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, RefreshCw } from "lucide-react";
import { cn } from "../utils";
import { SkillMarkdown } from "./SkillMarkdown";
import { saveSkillTranslation, type DocumentLanguage, type SkillTranslation } from "../lib/skillTranslation";
import { getErrorMessage } from "../lib/error";

interface Props {
  skillId: string;
  original: string;
  translation: SkillTranslation | null;
  language: DocumentLanguage;
  loading: boolean;
  error: string;
  headingIdPrefix: string;
  repeatedTitle: string;
  onLanguageChange: (language: DocumentLanguage) => void;
  onReload: () => void;
  onSaved: (translation: SkillTranslation) => void;
}

export function SkillTranslationReader({ skillId, original, translation, language, loading, error, headingIdPrefix, repeatedTitle, onLanguageChange, onReload, onSaved }: Props) {
  const { t } = useTranslation();
  const editorId = useId();
  const [draft, setDraft] = useState<{ content: string; sourceHash: string; revision: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const content = language === "zh-CN" && translation?.content ? translation.content : original;
  const button = "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40";

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || saving) return;
    setSaving(true); setSaveError("");
    try {
      const next = await saveSkillTranslation(skillId, draft.content, draft.sourceHash, draft.revision);
      onSaved(next);
      onLanguageChange("zh-CN");
      setDraft(null); setSaved(true);
    } catch (cause) { setSaveError(getErrorMessage(cause, t("skillTranslation.saveFailed"))); }
    finally { setSaving(false); }
  }

  return <div className="mx-auto w-full max-w-[860px]">
    <div className="mb-5 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label={t("skillTranslation.language")} className="inline-flex rounded-lg bg-surface-hover p-1">
          {(["zh-CN", "original"] as const).map(value => <button
            key={value} type="button" aria-pressed={language === value}
            disabled={value === "zh-CN" && !translation?.content}
            title={value === "zh-CN" && !translation?.content ? t("skillTranslation.missing") : undefined}
            onClick={() => onLanguageChange(value)}
            className={cn(button, language === value ? "bg-surface font-medium text-accent shadow-sm" : "text-tertiary hover:text-secondary")}
          >{t(value === "zh-CN" ? "skillTranslation.chinese" : "skillTranslation.original")}</button>)}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onReload} disabled={loading || saving} className={cn(button, "text-muted hover:bg-surface-hover")} title={t("skillTranslation.retry")} aria-label={t("skillTranslation.retry")}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
          {!draft && <button type="button" disabled={loading || !translation || !!error} className={cn(button, "text-secondary hover:bg-surface-hover")}
            onClick={() => { if (translation) { setDraft({ content: translation.content ?? "", sourceHash: translation.source_hash, revision: translation.revision }); setSaveError(""); setSaved(false); } }}>
            <Pencil className="h-3.5 w-3.5" />{t(translation?.content ? "skillTranslation.edit" : "skillTranslation.add")}
          </button>}
        </div>
      </div>
      <p className="text-[12px] text-muted" aria-live="polite">
        {loading ? t("skillTranslation.loading") : error ? t("skillTranslation.loadFailed") : !translation?.content ? t("skillTranslation.missing") : t(language === "zh-CN" ? "skillTranslation.readingChinese" : "skillTranslation.readingOriginal")}
      </p>
      {error && <p role="alert" className="break-words text-[12.5px] text-danger">{error}</p>}
      {language === "zh-CN" && translation?.stale && <p role="status" className="rounded-md border border-border-subtle bg-surface-hover px-3 py-2 text-[12.5px] text-secondary">{t("skillTranslation.stale")}</p>}
      {saved && <p role="status" className="text-[12px] text-accent">{t("skillTranslation.saved")}</p>}
    </div>
    {draft && <form onSubmit={save} className="mb-6 space-y-3 rounded-lg border border-border-subtle bg-surface p-4">
      <label htmlFor={editorId} className="block text-[13px] font-medium text-primary">{t("skillTranslation.editorLabel")}</label>
      <p id={`${editorId}-hint`} className="text-[12.5px] leading-5 text-tertiary">{t("skillTranslation.editorHint")}</p>
      <textarea id={editorId} aria-describedby={`${editorId}-hint`} value={draft.content} disabled={saving} rows={14}
        onChange={event => setDraft({ ...draft, content: event.target.value })} placeholder={t("skillTranslation.placeholder")}
        className="w-full resize-y rounded-md border border-border-subtle bg-background px-3 py-2 font-mono text-[13px] leading-6 text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-60" />
      {saveError && <div role="alert" className="text-[12.5px] text-danger"><p>{saveError}</p><p className="mt-1">{t("skillTranslation.sourceChanged")}</p></div>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={saving || !draft.content.trim()} className={cn(button, "bg-accent text-white hover:opacity-90")}>{t(saving ? "skillTranslation.saving" : "skillTranslation.save")}</button>
        <button type="button" disabled={saving} onClick={() => { setDraft(null); setSaveError(""); }} className={cn(button, "border border-border-subtle text-secondary hover:bg-surface-hover")}>{t("skillTranslation.cancel")}</button>
      </div>
    </form>}
    <SkillMarkdown content={content} headingIdPrefix={headingIdPrefix} hideFirstHeading repeatedTitle={repeatedTitle} variant="detail" />
  </div>;
}
