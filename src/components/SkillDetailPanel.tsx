import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown, ChevronUp, Github, HardDrive, Globe, ArrowLeft,
  ListTree, Boxes, Link2, Info, PanelRightOpen, RefreshCw, History,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../utils";
import {
  getSkillDocument,
  getSourceSkillDocument,
  getSkillSourceDiff,
  type ManagedSkill,
  type Project,
  type SkillDocument,
  type SourceSkillDocument,
  type SkillSourceDiff,
  type SkillToolToggle,
  type ToolInfo,
} from "../lib/tauri";
import { SkillSourceDiffViewer } from "./SkillSourceDiffViewer";
import { SkillMarkdown } from "./SkillMarkdown";
import { extractHeadings } from "../lib/markdownOutline";
import { AgentToggleSection, type AgentToggleItem } from "./AgentToggleSection";
import { SkillProjectsSection } from "./SkillProjectsSection";
import { SyncDots } from "./SyncDots";

type ContentTab = "doc" | "sourceDiff" | "activity";

interface Props {
  skill: ManagedSkill | null;
  onClose: () => void;
  tools?: ToolInfo[];
  toolToggles?: SkillToolToggle[] | null;
  togglingTool?: string | null;
  onToggleTool?: (tool: string, enabled: boolean) => void;
  projects?: Project[];
  onProjectsChanged?: () => void;
  /** 更新（git/skillssh）或重新导入（local/import）。 */
  onUpdate?: (skill: ManagedSkill) => Promise<void>;
  busyAction?: string | null;
}

export function SkillDetailPanel({
  skill,
  onClose,
  tools,
  toolToggles,
  togglingTool,
  onToggleTool,
  projects,
  onProjectsChanged,
  onUpdate,
  busyAction,
}: Props) {
  if (!skill) return null;

  const panelKey = [
    skill.id,
    skill.updated_at,
    skill.source_type,
    skill.source_ref ?? "",
    skill.source_revision ?? "",
    skill.remote_revision ?? "",
  ].join(":");

  return (
    <SkillDetailPanelContent
      key={panelKey}
      skill={skill}
      onClose={onClose}
      tools={tools}
      toolToggles={toolToggles}
      togglingTool={togglingTool}
      onToggleTool={onToggleTool}
      projects={projects}
      onProjectsChanged={onProjectsChanged}
      onUpdate={onUpdate}
      busyAction={busyAction}
    />
  );
}

interface ContentProps {
  skill: ManagedSkill;
  onClose: () => void;
  tools?: ToolInfo[];
  toolToggles?: SkillToolToggle[] | null;
  togglingTool?: string | null;
  onToggleTool?: (tool: string, enabled: boolean) => void;
  projects?: Project[];
  onProjectsChanged?: () => void;
  onUpdate?: (skill: ManagedSkill) => Promise<void>;
  busyAction?: string | null;
}

function SkillDetailPanelContent({
  skill,
  onClose,
  tools,
  toolToggles,
  togglingTool,
  onToggleTool,
  projects,
  onProjectsChanged,
  onUpdate,
  busyAction,
}: ContentProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<SkillDocument | null>(null);
  const [sourceDoc, setSourceDoc] = useState<SourceSkillDocument | null>(null);
  const [sourceDiff, setSourceDiff] = useState<SkillSourceDiff | null>(null);
  const [sourceDiffFailed, setSourceDiffFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isSourceInfoExpanded, setIsSourceInfoExpanded] = useState(false);
  const [contentTab, setContentTab] = useState<ContentTab>("doc");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeHeading, setActiveHeading] = useState<string | null>(null);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const localRequestIdRef = useRef(0);
  const sourceRequestIdRef = useRef(0);
  const diffRequestedRef = useRef(false);
  const skillId = skill.id;
  const tocPrefix = `skill-${skill.id}`;
  const supportsSourceDiff =
    skill.source_type === "git"
    || skill.source_type === "skillssh"
    || ((skill.source_type === "local" || skill.source_type === "import") && !!skill.source_ref);
  const localDocVersion = `${skill.id}:${skill.updated_at}`;
  const sourceDocVersion = [
    skill.id,
    skill.source_type,
    skill.source_ref ?? "",
    skill.source_ref_resolved ?? "",
    skill.source_revision ?? "",
    skill.remote_revision ?? "",
  ].join(":");

  useEffect(() => {
    localRequestIdRef.current += 1;
    const requestId = localRequestIdRef.current;

    getSkillDocument(skillId)
      .then((nextDoc) => {
        if (requestId === localRequestIdRef.current) {
          setDoc(nextDoc);
        }
      })
      .catch(() => {
        if (requestId === localRequestIdRef.current) {
          setDoc(null);
        }
      })
      .finally(() => {
        if (requestId === localRequestIdRef.current) {
          setLoading(false);
        }
      });
  }, [skillId, localDocVersion]);

  useEffect(() => {
    if (!supportsSourceDiff) {
      return;
    }

    sourceRequestIdRef.current += 1;
    const requestId = sourceRequestIdRef.current;

    getSourceSkillDocument(skillId)
      .then((nextDoc) => {
        if (requestId === sourceRequestIdRef.current) {
          setSourceDoc(nextDoc);
        }
      })
      .catch(() => {
        if (requestId === sourceRequestIdRef.current) {
          setSourceDoc(null);
        }
      });
  }, [skillId, supportsSourceDiff, sourceDocVersion]);

  // 差异按需加载：git/skills.sh 需要克隆仓库，仅在打开"来源与差异"页签时付出成本。
  useEffect(() => {
    if (contentTab !== "sourceDiff" || !supportsSourceDiff) return;
    if (diffRequestedRef.current) return;
    diffRequestedRef.current = true;

    getSkillSourceDiff(skillId)
      .then((diff) => setSourceDiff(diff))
      .catch(() => setSourceDiffFailed(true));
  }, [contentTab, supportsSourceDiff, skillId]);

  const activeDoc = doc?.skill_id === skill.id ? doc : null;
  const activeSourceDoc = sourceDoc?.skill_id === skill.id ? sourceDoc : null;
  const activeSourceDiff = sourceDiff?.skill_id === skill.id ? sourceDiff : null;
  const sourceDiffLoading =
    contentTab === "sourceDiff" && supportsSourceDiff && !activeSourceDiff && !sourceDiffFailed;
  const toggleItems: AgentToggleItem[] = (toolToggles ?? []).map((toggle) => ({
    key: toggle.tool,
    displayName: toggle.display_name,
    enabled: toggle.enabled,
    isAvailable: toggle.installed && toggle.globally_enabled,
    disabled: !toggle.installed || !toggle.globally_enabled,
    badgeLabel: !toggle.installed
      ? t("mySkills.agentToggleNotInstalled")
      : !toggle.globally_enabled
        ? t("mySkills.agentToggleDisabledGlobally")
        : null,
  }));

  const sourceIcon = (type: string) => {
    switch (type) {
      case "git":
      case "skillssh":
        return <Github className="h-3.5 w-3.5" />;
      case "local":
      case "import":
        return <HardDrive className="h-3.5 w-3.5" />;
      default:
        return <Globe className="h-3.5 w-3.5" />;
    }
  };

  const sourceTypeLabel = (type: string) => (type === "skillssh" ? "skills.sh" : type);

  const metadataItems = [
    { label: t("mySkills.sourceType"), value: sourceTypeLabel(skill.source_type) },
    { label: t("mySkills.sourceRef"), value: skill.source_ref },
    { label: t("mySkills.sourceResolved"), value: skill.source_ref_resolved },
    { label: t("mySkills.sourceBranch"), value: skill.source_branch },
    { label: t("mySkills.sourceSubpath"), value: skill.source_subpath },
    { label: t("mySkills.sourceRevision"), value: skill.source_revision },
  ].filter((item) => Boolean(item.value));

  // 目录：跳过与技能名重复的首个标题（页头已展示）。
  const headings = useMemo(
    () => (activeDoc ? extractHeadings(activeDoc.content, { skipFirst: true }) : []),
    [activeDoc]
  );

  // 滚动高亮当前小节：取视口顶部附近最后一个标题。
  useEffect(() => {
    const container = mainScrollRef.current;
    if (!container || contentTab !== "doc" || headings.length === 0) return;
    const onScroll = () => {
      const top = container.getBoundingClientRect().top + 80;
      let current: string | null = null;
      for (const heading of headings) {
        const element = document.getElementById(`${tocPrefix}-heading-${heading.line}`);
        if (element && element.getBoundingClientRect().top <= top) current = `${tocPrefix}-heading-${heading.line}`;
      }
      setActiveHeading(current);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => container.removeEventListener("scroll", onScroll);
  }, [headings, contentTab, tocPrefix]);

  function jumpToHeading(line: number) {
    const element = document.getElementById(`${tocPrefix}-heading-${line}`);
    element?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function runUpdate() {
    if (!onUpdate) return;
    void onUpdate(skill);
  }

  const hasUpdateSource = ["git", "skillssh"].includes(skill.source_type)
    || (["local", "import"].includes(skill.source_type) && !!skill.source_ref);
  const updateLabel = ["git", "skillssh"].includes(skill.source_type)
    ? skill.update_status === "update_available"
      ? t("mySkills.detail.updateSkill")
      : t("mySkills.detail.checkUpdate")
    : t("mySkills.detail.reimport");
  // busyAction 为技能 id：更新与检查共用同一入口（由技能库页串行管理）。
  const updateBusy = busyAction === skill.id;

  const toc = (
    <SidebarSection icon={<ListTree className="h-3.5 w-3.5" />} title={t("mySkills.detail.toc")}>
      {headings.length === 0 ? (
        <p className="px-2 py-1 text-[12px] text-tertiary">{t("mySkills.detail.tocEmpty")}</p>
      ) : (
        <nav className="flex flex-col" aria-label={t("mySkills.detail.toc")}>
          {headings.map((heading) => {
            const id = `${tocPrefix}-heading-${heading.line}`;
            return (
              <button
                key={id}
                type="button"
                onClick={() => jumpToHeading(heading.line)}
                aria-current={activeHeading === id ? "true" : undefined}
                className={cn(
                  "rounded-md px-2 py-1 text-left text-[12.5px] transition-colors outline-none hover:bg-surface-hover focus-visible:outline focus-visible:outline-accent",
                  heading.level === 1 && "pl-2",
                  heading.level === 2 && "pl-4",
                  heading.level === 3 && "pl-6",
                  activeHeading === id
                    ? "border-l-2 border-accent bg-accent-bg/60 font-medium text-accent-light"
                    : "border-l-2 border-transparent text-tertiary"
                )}
              >
                <span className="block truncate" title={heading.text}>{heading.text}</span>
              </button>
            );
          })}
        </nav>
      )}
    </SidebarSection>
  );

  const deploySection = toolToggles && onToggleTool ? (
    <SidebarSection icon={<Boxes className="h-3.5 w-3.5" />} title={t("mySkills.detail.deployToTools")}>
      <AgentToggleSection
        items={toggleItems}
        togglingKey={togglingTool}
        onToggle={onToggleTool}
      />
    </SidebarSection>
  ) : null;

  const projectsSection = projects && projects.length > 0 ? (
    <SidebarSection icon={<Link2 className="h-3.5 w-3.5" />} title={t("mySkills.detail.projects")}>
      <SkillProjectsSection
        skill={skill}
        projects={projects}
        onChanged={onProjectsChanged}
      />
    </SidebarSection>
  ) : null;

  const sourceInfo = metadataItems.length > 0 ? (
    <SidebarSection icon={<Info className="h-3.5 w-3.5" />} title={t("mySkills.detail.sourceInfo")}>
      <button
        type="button"
        onClick={() => setIsSourceInfoExpanded((prev) => !prev)}
        aria-expanded={isSourceInfoExpanded}
        aria-controls="skill-source-metadata"
        className="flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-[12.5px] text-muted outline-none hover:text-secondary focus-visible:outline focus-visible:outline-accent"
      >
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border-subtle bg-bg-secondary px-2 py-0.5 text-[11.5px]">
            {sourceIcon(skill.source_type)}
            {sourceTypeLabel(skill.source_type)}
          </span>
          <span className="truncate">{skill.source_branch || skill.source_revision?.slice(0, 7) || ""}</span>
        </span>
        {isSourceInfoExpanded ? <ChevronUp className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
      </button>
      {isSourceInfoExpanded && (
        <div id="skill-source-metadata" className="mt-1 flex flex-col gap-2 px-2 pb-1">
          {metadataItems.map((item) => (
            <div key={item.label} className="min-w-0">
              <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-faint">{item.label}</div>
              <div className="mt-0.5 break-all font-mono text-[12px] text-secondary">{item.value}</div>
            </div>
          ))}
        </div>
      )}
    </SidebarSection>
  ) : null;

  const sidebar = (
    <>
      {contentTab === "doc" && toc}
      {deploySection}
      {projectsSection}
      {sourceInfo}
    </>
  );

  return createPortal(
    <div className="fixed top-[28px] right-0 bottom-0 left-[220px] z-40 isolate">
      <div
        className="absolute inset-0 z-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="absolute inset-0 z-10 flex min-h-0 flex-col overflow-hidden border-l border-border-subtle bg-bg-secondary">
        {/* 页头：滚动时保持可访问 */}
        <header className="shrink-0 border-b border-border-subtle bg-bg-secondary px-6 pb-3 pt-4">
          <div className="flex min-w-0 items-start justify-between gap-4">
            <div className="min-w-0">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 rounded-md text-[12.5px] text-muted transition-colors outline-none hover:text-secondary focus-visible:outline focus-visible:outline-accent"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                {t("mySkills.detail.back")}
              </button>
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="min-w-0 truncate text-[24px] font-semibold leading-tight tracking-tight text-primary">
                  {skill.name}
                </h2>
                {skill.update_status === "update_available" && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11.5px] font-medium text-amber-500">
                    {t("mySkills.detail.badgeUpdateAvailable")}
                  </span>
                )}
              </div>
              {skill.description && (
                <p className="mt-1 line-clamp-2 text-[13.5px] leading-6 text-secondary">{skill.description}</p>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                <span title={skill.author_source ?? undefined}>
                  {t("mySkills.author")}: {skill.author || t("mySkills.authorMissing")}
                </span>
                {tools && <SyncDots skill={skill} tools={tools} size="sm" includeOrphan />}
                {skill.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-medium text-secondary"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 pr-0 pt-6">
              {hasUpdateSource && onUpdate ? (
                <button
                  type="button"
                  onClick={runUpdate}
                  disabled={updateBusy || busyAction === `check:${skill.id}`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-white transition-colors outline-none hover:bg-accent-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", updateBusy && "animate-spin")} />
                  {updateBusy ? t("mySkills.detail.updating") : updateLabel}
                </button>
              ) : (
                <span
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-2 text-[12.5px] text-faint"
                  title={t("mySkills.detail.noSource")}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t("mySkills.detail.noSource")}
                </span>
              )}
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="rounded-lg border border-border-subtle p-2 text-muted transition-colors outline-none hover:bg-surface-hover hover:text-secondary focus-visible:outline focus-visible:outline-accent lg:hidden"
                aria-label={t("mySkills.detail.sidebar")}
              >
                <PanelRightOpen className="h-4 w-4" />
              </button>
            </div>
          </div>
          {/* 页签层级：文档 / 来源与差异 / 调用记录 */}
          <nav className="mt-3 flex items-center gap-1" aria-label={t("mySkills.detail.doc")}>
            {([
              ["doc", t("mySkills.detail.tabDoc")],
              ...(supportsSourceDiff ? [["sourceDiff", t("mySkills.detail.tabSourceDiff")] as [ContentTab, string]] : []),
              ["activity", t("mySkills.detail.tabActivity")],
            ] as [ContentTab, string][]).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  setContentTab(tab as ContentTab);
                  mainScrollRef.current?.scrollTo({ top: 0 });
                }}
                aria-current={contentTab === tab ? "page" : undefined}
                className={cn(
                  "rounded-t-lg border-b-2 px-3 py-1.5 text-[12.5px] font-medium transition-colors outline-none focus-visible:outline focus-visible:outline-accent",
                  contentTab === tab
                    ? "border-accent text-primary"
                    : "border-transparent text-muted hover:text-secondary"
                )}
              >
                {label}
              </button>
            ))}
          </nav>
        </header>

        <div className="flex min-h-0 flex-1">
          <main ref={mainScrollRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-5 scrollbar-hide">
            {loading ? (
              <div className="mt-12 text-center text-[13px] text-muted">{t("common.loading")}</div>
            ) : contentTab === "sourceDiff" ? (
              <div className="flex flex-col gap-6">
                {activeSourceDiff ? (
                  <section aria-label={t("mySkills.detail.viewDiff")}>
                    <h3 className="mb-2 text-[14px] font-semibold text-primary">{t("mySkills.detail.viewDiff")}</h3>
                    <SkillSourceDiffViewer entries={activeSourceDiff.entries} />
                  </section>
                ) : sourceDiffLoading ? (
                  <div className="mt-6 text-center text-[13px] text-muted">{t("common.loading")}</div>
                ) : sourceDiffFailed || !supportsSourceDiff ? null : (
                  <div className="mt-6 text-center text-[13px] text-muted">{t("common.loading")}</div>
                )}
                {activeSourceDoc && (
                  <section aria-label={t("mySkills.detail.viewSource")}>
                    <h3 className="mb-2 text-[14px] font-semibold text-primary">{t("mySkills.detail.viewSource")}</h3>
                    <p className="mb-3 text-[12.5px] text-muted">
                      {activeSourceDoc.source_label} · {activeSourceDoc.revision.slice(0, 7)}
                    </p>
                    <SkillMarkdown content={activeSourceDoc.content} hideFirstHeading />
                  </section>
                )}
                {!activeSourceDiff && !activeSourceDoc && !sourceDiffLoading && (
                  <div className="mt-12 text-center text-[13px] text-muted">{t("mySkills.sourceDiffUnavailable")}</div>
                )}
              </div>
            ) : contentTab === "activity" ? (
              <div className="mx-auto max-w-[860px] py-10 text-center">
                <History className="mx-auto h-7 w-7 text-muted" />
                <p className="mt-3 text-[13.5px] text-secondary">{t("mySkills.detail.activityHint")}</p>
                <button
                  type="button"
                  onClick={() => navigate(`/skill-activity?skill=${encodeURIComponent(skill.name)}`)}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-[12.5px] font-medium text-white transition-colors outline-none hover:bg-accent-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {t("mySkills.detail.activityOpen")}
                </button>
              </div>
            ) : activeDoc ? (
              <SkillMarkdown
                content={activeDoc.content}
                headingIdPrefix={tocPrefix}
                hideFirstHeading
              />
            ) : (
              <div className="mt-12 text-center text-[13px] text-muted">{t("common.documentMissing")}</div>
            )}
          </main>

          {/* 右侧辅助栏：宽窗口常驻，窄窗口收起为抽屉 */}
          <aside className="hidden w-[290px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-border-subtle bg-surface/40 px-3 py-4 scrollbar-hide lg:flex">
            {sidebar}
          </aside>
          {drawerOpen && (
            <div className="absolute inset-0 z-20 flex lg:hidden" role="dialog" aria-label={t("mySkills.detail.sidebar")}>
              <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
              <div className="relative ml-auto flex w-[300px] max-w-[85%] flex-col gap-4 overflow-y-auto border-l border-border-subtle bg-bg-secondary px-3 py-4">
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="self-end rounded-md p-1.5 text-muted outline-none hover:bg-surface-hover hover:text-secondary focus-visible:outline focus-visible:outline-accent"
                  aria-label={t("common.close")}
                >
                  ×
                </button>
                {sidebar}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function SidebarSection({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border-subtle bg-surface/70 p-2.5">
      <h3 className="mb-2 flex items-center gap-1.5 px-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-tertiary">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}
