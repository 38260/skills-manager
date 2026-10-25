import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, FolderOpen } from "lucide-react";
import { DetailSheet } from "./DetailSheet";
import { SkillTranslationControls, SkillTranslationReader, TRANSLATION_EDITOR_EVENT } from "./SkillTranslationReader";
import { useDiscoveredSkillTranslation } from "../hooks/useDiscoveredSkillTranslation";
import {
  getDiscoveredSkillDocument, resolveDocumentLanguage, saveDiscoveredSkillTranslation,
  type DiscoveredSkillDocument, type DocumentLanguage,
} from "../lib/skillTranslation";
import { openPath } from "../lib/tauri";
import { getErrorMessage } from "../lib/error";
import type { DiscoveredGroup } from "../lib/tauri";
import { cn } from "../utils";

/** 详情面板内的路径超链接：点击在文件管理器中定位该技能目录。 */
function PathLink({ path, className }: { path: string; className?: string }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={() => void openPath(path, true).catch(() => {})}
      title={t("install.scan.revealPath")}
      className={cn("min-w-0 truncate text-left text-[13px] text-muted underline decoration-border-subtle underline-offset-2 transition-colors hover:text-accent hover:decoration-accent", className)}
    >
      {path}
    </button>
  );
}

/**
 * 本地发现技能（尚未纳管）的详情面板：复用 DetailSheet + 译文读写组件，
 * 与纳管技能详情的差异只有数据来源——按发现路径读取，不依赖技能库中的技能 ID。
 */
export function DiscoveredSkillSheet({ group, onClose }: { group: DiscoveredGroup; onClose: () => void }) {
  const { t } = useTranslation();
  const primaryPath = group.locations[0]?.found_path ?? "";
  const [doc, setDoc] = useState<DiscoveredSkillDocument | null>(null);
  const [docError, setDocError] = useState("");
  const [languageChoice, setLanguageChoice] = useState<DocumentLanguage | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  // 译文与文档相互独立：译文接口在后端自读原文计算哈希，无需等文档就绪。
  const translationState = useDiscoveredSkillTranslation(primaryPath, "");

  useEffect(() => {
    if (!primaryPath) return;
    let current = true;
    getDiscoveredSkillDocument(primaryPath)
      .then(result => { if (current) { setDoc(result); setDocError(""); } })
      .catch(error => { if (current) { setDoc(null); setDocError(getErrorMessage(error, t("install.scan.detail.loadFailed"))); } });
    return () => { current = false; };
  }, [primaryPath, t]);

  // 编辑器事件由 SkillTranslationControls 发出，按发现路径过滤，避免同时打开多个面板时串扰。
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ skillId?: string }>).detail;
      if (detail?.skillId !== primaryPath) return;
      setDraftOpen(true);
    };
    document.addEventListener(TRANSLATION_EDITOR_EVENT, onOpen);
    return () => document.removeEventListener(TRANSLATION_EDITOR_EVENT, onOpen);
  }, [primaryPath]);

  const foundDate = new Date(group.found_at).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });

  return (
    <DetailSheet
      open
      title={group.name}
      description={doc?.description ?? undefined}
      onClose={onClose}
      meta={
        <div className="space-y-2 text-[13px] text-muted">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border-subtle bg-surface px-2 py-0.5">
              <FolderOpen className="h-3 w-3" />
              {t("install.scan.locations", { count: group.locations.length })}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-[11px]">
              <Calendar className="h-3 w-3" />
              {foundDate}
            </span>
          </div>
          <div className="space-y-1">
            {group.locations.map(location => (
              <div key={location.id} className="flex min-w-0 items-center gap-2">
                <span className="inline-flex shrink-0 rounded-[4px] border border-border-subtle bg-surface px-1.5 py-px text-[13px] font-medium text-tertiary">
                  {location.tool === "custom_discovery" ? t("install.scan.customSource") : location.tool}
                </span>
                <PathLink path={location.found_path} className="flex-1" />
              </div>
            ))}
          </div>
        </div>
      }
    >
      {docError ? (
        <p role="alert" className="rounded-md border border-border-subtle bg-surface px-3 py-2 text-[13px] text-danger">{docError}</p>
      ) : !doc ? (
        <p className="py-6 text-center text-[13px] text-muted">{t("skillTranslation.loading")}</p>
      ) : (
        <div>
          <div className="mb-4 flex items-center justify-end">
            <SkillTranslationControls
              skillId={primaryPath}
              original={doc.content}
              state={translationState}
              language={resolveDocumentLanguage(languageChoice)}
              onLanguageChange={setLanguageChoice}
            />
          </div>
          <SkillTranslationReader
            skillId={primaryPath}
            original={doc.content}
            translation={translationState.translation}
            loading={translationState.loading}
            error={translationState.error}
            reload={translationState.reload}
            accept={translationState.accept}
            language={resolveDocumentLanguage(languageChoice)}
            draftOpen={draftOpen}
            onDraftClose={() => setDraftOpen(false)}
            headingIdPrefix={`discovered-${group.key}`}
            repeatedTitle={group.name}
            onLanguageChange={setLanguageChoice}
            onSaved={translationState.accept}
            saveTranslation={saveDiscoveredSkillTranslation}
          />
        </div>
      )}
    </DetailSheet>
  );
}
