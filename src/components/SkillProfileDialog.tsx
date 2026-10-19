import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Layers, Plus, Tag, X } from "lucide-react";
import { createPortal } from "react-dom";
import { cn } from "../utils";
import { setSkillProfile, setSkillTags, type ManagedSkill } from "../lib/tauri";
import { PRESET_ICON_OPTIONS } from "../lib/presetIcons";
import { inferSkillIconKey, tagsMatchingIcon } from "../lib/iconMatch";

interface Props {
  skill: ManagedSkill | null;
  /** Every tag in the library, used to match a logo against existing categories. */
  allTags: string[];
  onClose: () => void;
  onSaved: (skill: ManagedSkill) => void;
}

/**
 * 编辑技能信息：别名、自定义说明、作者、logo、标签。
 * 只写入技能库数据库里的展示信息，不改动 SKILL.md 与已部署的副本；清空即回退到技能文件里的值。
 */
export function SkillProfileDialog({ skill, allTags, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const [alias, setAlias] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [authorOverride, setAuthorOverride] = useState("");
  const [icon, setIcon] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const skillId = skill?.id ?? null;
  useEffect(() => {
    if (!skill) return;
    setAlias(skill.alias ?? "");
    setCustomDescription(skill.custom_description ?? "");
    setAuthorOverride(skill.author_override ?? "");
    setIcon(skill.icon ?? "");
    setTags(skill.tags ?? []);
    setError("");
  }, [skill, skillId]);

  useEffect(() => {
    if (!skill) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [skill, onClose]);

  // logo 留空表示跟随标签与说明自动匹配；选中项与标签命中同一个图标时标出来源，
  // 免得用户以为网格里的顺序或颜色就是技能本身的属性。
  const autoKey = useMemo(() => (skill ? inferSkillIconKey({ ...skill, icon: null }) : "layers"), [skill]);
  const resolvedKey = icon || autoKey;
  const matchedTagLabels = useMemo(
    () => tagsMatchingIcon(resolvedKey, allTags).filter((tag) => !tags.includes(tag)),
    [resolvedKey, allTags, tags]
  );
  const autoMatchedTag = useMemo(() => {
    const hit = tagsMatchingIcon(autoKey, skill?.tags ?? [])[0];
    return hit ? { key: autoKey, tag: hit } : null;
  }, [autoKey, skill]);

  if (!skill) return null;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!skill) return;
    setSaving(true); setError("");
    try {
      const updated = await setSkillProfile(skill.id, { alias, customDescription, authorOverride, icon });
      const before = skill.tags ?? [];
      const changed = before.length !== tags.length || before.some((tag, index) => tag !== tags[index]);
      if (changed) await setSkillTags(skill.id, tags);
      onSaved(updated);
      onClose();
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause));
    } finally { setSaving(false); }
  }

  const field = "w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-[13px] text-primary outline-none placeholder:text-faint focus:border-accent focus:ring-1 focus:ring-accent";
  const toggleTag = (value: string) =>
    setTags(prev => (prev.includes(value) ? prev.filter(tag => tag !== value) : [...prev, value]));

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={t("mySkills.profile.title")}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <form onSubmit={save} className="relative flex max-h-[92vh] w-full max-w-[520px] flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-card-hover">
        <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-primary">{t("mySkills.profile.title")}</h2>
            <p className="mt-0.5 truncate text-[12.5px] text-tertiary" title={skill.name}>{skill.name}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted outline-none hover:bg-surface-hover hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent" aria-label={t("common.cancel")}>
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
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

          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-secondary">{t("mySkills.profile.icon")}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIcon("")}
                aria-pressed={!icon}
                title={t("mySkills.profile.iconAutoHint")}
                className={cn(
                  "flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  !icon ? "border-accent/40 bg-accent-bg text-accent-light" : "border-border-subtle text-muted hover:border-border hover:text-secondary"
                )}
              >
                <Layers className="h-3.5 w-3.5" />
                {t("mySkills.profile.iconAuto")}
              </button>
              {icon && (
                <button type="button" onClick={() => setIcon("")}
                  className="text-[11.5px] text-faint underline-offset-2 hover:text-secondary hover:underline">
                  {t("mySkills.profile.iconReset")}
                </button>
              )}
            </div>
            <div className="grid max-h-[220px] grid-cols-[repeat(auto-fill,minmax(36px,1fr))] gap-1.5 overflow-y-auto pr-1">
              {PRESET_ICON_OPTIONS.map((option) => {
                const OptionIcon = option.icon;
                const selected = option.key === resolvedKey;
                const isAuto = !icon && option.key === autoKey;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setIcon(option.key)}
                    aria-pressed={selected}
                    title={isAuto && autoMatchedTag
                      ? t("mySkills.profile.iconMatchedByTag", { tag: autoMatchedTag.tag })
                      : option.label}
                    className={cn(
                      "relative flex h-9 items-center justify-center rounded-lg border bg-background transition-all outline-none focus-visible:ring-2 focus-visible:ring-accent",
                      selected
                        ? `${option.activeClass} ${option.colorClass}`
                        : "border-border-subtle text-muted hover:border-border hover:text-secondary"
                    )}
                  >
                    <OptionIcon className="h-3.5 w-3.5" />
                    {isAuto && (
                      <span className="absolute -right-1 -top-1 rounded-full bg-accent px-1 text-[9px] leading-3 text-white">
                        {t("mySkills.profile.iconAutoBadge")}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <span className="text-[11.5px] text-faint">
              {!icon && autoMatchedTag
                ? t("mySkills.profile.iconMatchedByTag", { tag: autoMatchedTag.tag })
                : t("mySkills.profile.iconHint")}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-secondary">
              <Tag className="h-3.5 w-3.5" />
              {t("mySkills.profile.tags")}
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.length === 0 && <span className="text-[12px] text-faint">{t("mySkills.profile.tagsEmpty")}</span>}
              {tags.map((tag) => (
                <button key={tag} type="button" onClick={() => toggleTag(tag)}
                  title={t("mySkills.profile.tagsRemove")}
                  className="inline-flex items-center gap-1 rounded-full bg-accent-bg px-2 py-0.5 text-[12px] font-medium text-accent-dark transition-colors hover:bg-red-500/15 hover:text-red-500 dark:text-accent-light">
                  {tag}
                  <X className="h-2.5 w-2.5" />
                </button>
              ))}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[11.5px] text-faint">{t("mySkills.profile.tagsSuggested")}：</span>
              {matchedTagLabels.length === 0 ? (
                <span className="text-[11.5px] text-faint">{t("mySkills.profile.tagsNone")}</span>
              ) : matchedTagLabels.map((tag) => (
                <button key={tag} type="button" onClick={() => toggleTag(tag)}
                  className="inline-flex items-center gap-1 rounded-full border border-border-subtle px-2 py-0.5 text-[12px] font-medium text-secondary transition-colors hover:border-accent hover:text-accent-light">
                  <Plus className="h-2.5 w-2.5" />
                  {tag}
                </button>
              ))}
            </div>
            <span className="text-[11.5px] text-faint">{t("mySkills.profile.tagsHint")}</span>
          </div>

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
