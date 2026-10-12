import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { cn } from "../utils";
import { setSkillProfile, type ManagedSkill } from "../lib/tauri";

interface Props {
  skill: ManagedSkill | null;
  onClose: () => void;
  onSaved: (skill: ManagedSkill) => void;
}

/**
 * 编辑技能信息：别名、自定义说明、作者覆盖。
 * 只写入技能库数据库里的展示信息，不改动 SKILL.md 与已部署的副本；清空即回退到技能文件里的值。
 */
export function SkillProfileDialog({ skill, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const [alias, setAlias] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [authorOverride, setAuthorOverride] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const skillId = skill?.id ?? null;
  useEffect(() => {
    if (!skill) return;
    setAlias(skill.alias ?? "");
    setCustomDescription(skill.custom_description ?? "");
    setAuthorOverride(skill.author_override ?? "");
    setError("");
  }, [skill, skillId]);

  useEffect(() => {
    if (!skill) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [skill, onClose]);

  if (!skill) return null;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!skill) return;
    setSaving(true); setError("");
    try {
      const updated = await setSkillProfile(skill.id, { alias, customDescription, authorOverride });
      onSaved(updated);
      onClose();
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause));
    } finally { setSaving(false); }
  }

  const field = "w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-[13px] text-primary outline-none placeholder:text-faint focus:border-accent focus:ring-1 focus:ring-accent";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={t("mySkills.profile.title")}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <form onSubmit={save} className="relative flex w-full max-w-[520px] flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-card-hover">
        <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-primary">{t("mySkills.profile.title")}</h2>
            <p className="mt-0.5 truncate text-[12.5px] text-tertiary" title={skill.name}>{skill.name}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted outline-none hover:bg-surface-hover hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent" aria-label={t("common.cancel")}>
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex flex-col gap-4 px-5 py-4">
          <p className="text-[12px] leading-5 text-tertiary">{t("mySkills.profile.hint")}</p>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-secondary">{t("mySkills.profile.alias")}</span>
            <input value={alias} onChange={event => setAlias(event.target.value)} maxLength={120}
              className={field} placeholder={skill.name} />
            <span className="text-[11.5px] text-faint">{t("mySkills.profile.aliasHint")}</span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-secondary">{t("mySkills.profile.description")}</span>
            <textarea value={customDescription} onChange={event => setCustomDescription(event.target.value)} maxLength={500} rows={3}
              className={cn(field, "resize-none leading-5")} placeholder={skill.description ?? ""} />
            <span className="text-[11.5px] text-faint">{t("mySkills.profile.descriptionHint")}</span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-secondary">{t("mySkills.profile.author")}</span>
            <input value={authorOverride} onChange={event => setAuthorOverride(event.target.value)} maxLength={120}
              className={field} placeholder={skill.author || t("mySkills.authorMissing")} />
            <span className="text-[11.5px] text-faint">{t("mySkills.profile.authorHint")}</span>
          </label>

          {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
          <button type="button" onClick={onClose} className="app-button-secondary h-9">{t("common.cancel")}</button>
          <button type="submit" disabled={saving} className="app-button-primary h-9">
            {t(saving ? "mySkills.profile.saving" : "common.save")}
          </button>
        </footer>
      </form>
    </div>,
    document.body
  );
}
