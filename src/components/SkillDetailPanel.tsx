import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown, ChevronUp, Github, HardDrive, Globe, ArrowLeft,
  ListTree, Boxes, Link2, Info, PanelRightOpen, RefreshCw, History, Layers, FileDiff,
  FolderTree, FolderOpen,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../utils";
import {
  getSkillDocument,
  getSourceSkillDocument,
  getSkillSourceDiff,
  openPath,
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
import { AgentIcon } from "./AgentIcon";
import { ToggleSwitch } from "./ToggleSwitch";
import { SkillProjectsSection } from "./SkillProjectsSection";
import { SkillStructureSection } from "./SkillStructureSection";
import { ActivityRecordList } from "./ActivityRecordList";
import { openExternal } from "../lib/desktop";
import { getActivity, type ActivityEvent } from "../lib/activity";

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
  const [sourceDocLoading, setSourceDocLoading] = useState(true);
  const [sourceFocus, setSourceFocus] = useState<"source" | "diff">("diff");
  const [loading, setLoading] = useState(true);
  const [isSourceInfoExpanded, setIsSourceInfoExpanded] = useState(false);
  const [contentTab, setContentTab] = useState<ContentTab>("doc");
  const [drawerOpen, setDrawerOpen] = useState(false);
  // 部署开关默认收起：技能详情以阅读文档为主，部署状态由标题右侧的已启用计数概括。
  const [deployExpanded, setDeployExpanded] = useState(false);
  const [sourceOpenError, setSourceOpenError] = useState("");
  // 正文向下滚动后页头收成紧凑形态，把纵向空间让给内容。
  const [scrolled, setScrolled] = useState(false);
  const [activityItems, setActivityItems] = useState<ActivityEvent[] | null>(null);
  const [activityError, setActivityError] = useState("");
  const [activityRevision, setActivityRevision] = useState(0);
  const [compact, setCompact] = useState(false);
  const [activeHeading, setActiveHeading] = useState<string | null>(null);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const sourceSectionRef = useRef<HTMLElement>(null);
  const diffSectionRef = useRef<HTMLElement>(null);
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
    const shell = shellRef.current;
    if (!shell) return;
    const observer = new ResizeObserver(entries => {
      const next = entries[0].contentRect.width <= 980;
      setCompact(next);
      if (!next) setDrawerOpen(false);
    });
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  // 页头紧凑化：正文滚动超过一屏的起始偏移后收起图标、描述并缩小字号与内边距。
  useEffect(() => {
    const container = mainScrollRef.current;
    if (!container) return;
    const onScroll = () => setScrolled(container.scrollTop > 24);
    container.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => container.removeEventListener("scroll", onScroll);
  }, [contentTab]);

  useEffect(() => {
    if (!drawerOpen || !compact) return;
    const drawer = drawerRef.current;
    if (!drawer) return;
    const main = mainScrollRef.current;
    const appRoot = document.getElementById("root");
    const wasInert = appRoot?.inert ?? false;
    if (appRoot) appRoot.inert = true;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(drawer.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]')).filter(element => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDrawerOpen(false); }
      if (event.key !== "Tab") return;
      const items = focusable(), first = items[0], last = items[items.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    drawer.addEventListener("keydown", onKey);
    return () => {
      drawer.removeEventListener("keydown", onKey);
      if (appRoot) appRoot.inert = wasInert;
      if (previous?.isConnected) previous.focus();
      else if (main?.isConnected) main.focus();
    };
  }, [drawerOpen, compact]);

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
      })
      .finally(() => {
        if (requestId === sourceRequestIdRef.current) setSourceDocLoading(false);
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

  // 调用记录内嵌展示：打开页签时按技能名读取，不跳转到独立页面。
  useEffect(() => {
    if (contentTab !== "activity") return;
    let current = true;
    getActivity({ skillName: skill.name, page: 1, pageSize: 20 })
      .then(result => { if (current) { setActivityItems(result.items); setActivityError(""); } })
      .catch(error => { if (current) { setActivityItems(null); setActivityError(String(error instanceof Error ? error.message : error)); } });
    return () => { current = false; };
  }, [contentTab, skill.name, activityRevision]);

  const activeDoc = doc?.skill_id === skill.id ? doc : null;
  const activeSourceDoc = sourceDoc?.skill_id === skill.id ? sourceDoc : null;
  const activeSourceDiff = sourceDiff?.skill_id === skill.id ? sourceDiff : null;
  const sourceDiffLoading =
    contentTab === "sourceDiff" && supportsSourceDiff && !activeSourceDiff && !sourceDiffFailed;

  useEffect(() => {
    if (contentTab !== "sourceDiff") return;
    const section = sourceFocus === "source" ? sourceSectionRef.current : diffSectionRef.current;
    section?.scrollIntoView({ block: "start" });
  }, [contentTab, sourceFocus, activeSourceDoc, activeSourceDiff]);

  function openComparison(target: "source" | "diff") {
    setSourceFocus(target);
    setContentTab("sourceDiff");
    const section = target === "source" ? sourceSectionRef.current : diffSectionRef.current;
    section?.scrollIntoView({ block: "start" });
  }
  const toggleItems = (toolToggles ?? []).map((toggle) => ({
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
  const availableItems = toggleItems.filter(item => item.isAvailable);
  const enabledAvailableCount = availableItems.filter(item => item.enabled).length;

  const sourceLocation = skill.source_ref_resolved || skill.source_ref || "";
  let webSource: URL | null = null;
  try {
    const parsed = new URL(sourceLocation);
    if (["https:", "http:"].includes(parsed.protocol)) webSource = parsed;
  } catch { /* 本地目录与 SSH 来源直接展示名称，不伪造网页地址。 */ }
  const sourceLabel = webSource
    ? `${webSource.hostname} · ${webSource.pathname.replace(/^\//, "").replace(/\.git$/, "")}`
    : `${sourceTypeLabel(skill.source_type)} · ${sourceLocation.replace(/\\/g, "/").replace(/\/$/, "").split("/").pop() || skill.name}`;
  const sourceHref = webSource ? webSource.origin + webSource.pathname.replace(/\.git$/, "") : null;

  // 来源位置：本地来源打开目录，远程来源打开网页；两者都直接交给系统处理。
  const localSourceLocation = ["local", "import"].includes(skill.source_type)
    ? skill.source_ref_resolved || skill.source_ref
    : null;
  const canOpenSourceLocation = Boolean(localSourceLocation || sourceHref);
  async function openSourceLocation() {
    setSourceOpenError("");
    try {
      if (localSourceLocation) await openPath(localSourceLocation, false);
      else if (sourceHref) await openExternal(sourceHref);
    } catch (error) { setSourceOpenError(String(error instanceof Error ? error.message : error)); }
  }

  // 直接打开当前展示的来源文档：本地来源交给系统默认程序，远程来源打开对应网页。
  async function openSourceFile() {
    setSourceOpenError("");
    try {
      const filename = activeSourceDoc?.filename ?? "SKILL.md";
      if (localSourceLocation) {
        const base = localSourceLocation.replace(/[\\/]+$/, "");
        await openPath(`${base}/${filename}`, false);
      } else if (sourceHref) await openExternal(sourceHref);
    } catch (error) { setSourceOpenError(String(error instanceof Error ? error.message : error)); }
  }

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

  function sourceTypeLabel(type: string) { return type === "skillssh" ? "skills.sh" : type; }

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
    () => (activeDoc ? extractHeadings(activeDoc.content, { skipFirst: true, repeatedTitle: skill.name }) : []),
    [activeDoc, skill.name]
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
    <SidebarSection icon={<ListTree className="h-[18px] w-[18px]" />} title={<>
      {t("mySkills.detail.toc")}
      {headings.length > 0 && <span className="ml-auto text-[11px] font-normal text-muted">{headings.length}</span>}
    </>}>
      {headings.length === 0 ? (
        <p className="px-2 py-1 text-[12px] text-tertiary">{t("mySkills.detail.tocEmpty")}</p>
      ) : (
        <nav className="flex max-h-[min(42vh,360px)] flex-col overflow-y-auto scrollbar-hide" aria-label={t("mySkills.detail.toc")}>
          {headings.map((heading) => {
            const id = `${tocPrefix}-heading-${heading.line}`;
            const active = activeHeading === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => jumpToHeading(heading.line)}
                aria-current={active ? "true" : undefined}
                title={heading.text}
                className={cn(
                  "flex items-start rounded-r-md border-l-[3px] py-1.5 pr-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
                  heading.level === 1 ? "pl-3" : heading.level === 2 ? "pl-6" : "pl-9",
                  active
                    ? "border-accent bg-accent-bg font-medium text-accent-dark dark:text-accent-light"
                    : "border-transparent text-tertiary hover:bg-surface-hover hover:text-secondary"
                )}
              >
                {/* 长标题折行显示两行，避免目录里的中文小节名被截断看不全。 */}
                <span className={cn("min-w-0 flex-1 break-words line-clamp-2", heading.level === 1 ? "text-[14px] leading-5" : "text-[13px] leading-[18px]")}>
                  {heading.text}
                </span>
              </button>
            );
          })}
        </nav>
      )}
    </SidebarSection>
  );

  // 部署到工具：默认收起，仅列出当前可用（已安装且全局启用）的工具，不可用工具不展示。
  const deploySection = toolToggles && onToggleTool ? (
    <SidebarSection icon={<Boxes className="h-[18px] w-[18px]" />} title={
      <button
        type="button"
        onClick={() => setDeployExpanded(value => !value)}
        aria-expanded={deployExpanded}
        className="flex w-full items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {t("mySkills.detail.deployToTools")}
        <span className="ml-auto text-[11px] font-normal text-muted">{t("mySkills.enabledSummary", { enabled: enabledAvailableCount, total: availableItems.length })}</span>
        {deployExpanded ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" />}
      </button>
    }>
      {deployExpanded && (availableItems.length === 0 ? (
        <p className="px-1 py-1 text-[12px] text-tertiary">{t("mySkills.detail.deployNone")}</p>
      ) : (
        <div className="flex flex-col">
          {availableItems.map(item => (
            <div key={item.key} className="flex min-h-[42px] min-w-0 items-center gap-3" title={tools?.find(tool => tool.key === item.key)?.skills_dir}>
              <AgentIcon agentKey={item.key} displayName={item.displayName} className="skill-detail-agent-icon h-5 w-5" />
              <span className="min-w-0 flex-1 truncate text-[15px] text-secondary">{item.displayName}</span>
              <ToggleSwitch checked={item.enabled} disabled={item.disabled} loading={togglingTool === item.key}
                onChange={() => onToggleTool(item.key, !item.enabled)} title={item.displayName} className="mr-1 scale-110" />
            </div>
          ))}
        </div>
      ))}
    </SidebarSection>
  ) : null;

  const structureSection = (
    <SidebarSection icon={<FolderTree className="h-[18px] w-[18px]" />} title={t("mySkills.detail.structure")}>
      <SkillStructureSection skillId={skill.id} version={localDocVersion} />
    </SidebarSection>
  );

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
    <SidebarSection icon={<Info className="h-[18px] w-[18px]" />} title={t("mySkills.detail.sourceInfo")}>
      <div className="mb-2 flex min-w-0 items-center gap-2 text-[14px] text-tertiary">
        <span className="min-w-0 flex-1 truncate" title={sourceLabel}>{sourceLabel}</span>
      </div>
      {canOpenSourceLocation && (
        <button
          type="button"
          onClick={() => void openSourceLocation()}
          className="mb-1 inline-flex items-center gap-1.5 rounded-md text-[12.5px] text-accent-dark outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent dark:text-accent-light"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          {t(localSourceLocation ? "mySkills.detail.openSourceFolder" : "mySkills.detail.openSourceLink")}
        </button>
      )}
      {sourceOpenError && <p role="alert" className="mb-1 text-[12px] text-danger">{sourceOpenError}</p>}
      <button
        type="button"
        onClick={() => setIsSourceInfoExpanded((prev) => !prev)}
        aria-expanded={isSourceInfoExpanded}
        className="flex w-full items-center justify-between gap-2 py-1 text-left text-[12px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="inline-flex shrink-0 items-center gap-1">
            {sourceIcon(skill.source_type)}
            {sourceTypeLabel(skill.source_type)}
          </span>
          <span className="truncate">{skill.source_branch || skill.source_revision?.slice(0, 7) || ""}</span>
        </span>
        {isSourceInfoExpanded ? <ChevronUp className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
      </button>
      {isSourceInfoExpanded && (
        <div className="mt-2 flex flex-col gap-3 pb-1">
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
      {structureSection}
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
      <div ref={shellRef} className="skill-detail-shell absolute inset-0 z-10 flex min-h-0 flex-col overflow-hidden border-l border-border-subtle bg-surface">
        {/* 页头：滚动时保持可访问；正文下滑后收成紧凑形态 */}
        <header
          inert={drawerOpen && compact}
          className={cn(
            "skill-detail-header shrink-0 bg-surface pl-12 pr-8 transition-all duration-200",
            scrolled ? "pt-2.5" : "pt-4"
          )}
        >
          <button
                type="button"
                onClick={onClose}
                className="flex w-fit items-center gap-1.5 rounded-md text-[12.5px] leading-5 text-muted transition-colors outline-none hover:text-secondary focus-visible:outline focus-visible:outline-accent"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                {t("mySkills.detail.back")}
          </button>
          <div className={cn("skill-detail-heading-row flex min-w-0 items-start justify-between gap-6 transition-all duration-200", scrolled ? "mt-1" : "mt-2.5")}>
            <div className="flex min-w-0 flex-1 items-start gap-3.5">
              {!scrolled && <Layers className="mt-0.5 h-8 w-8 shrink-0 text-accent" strokeWidth={1.7} aria-hidden="true" />}
              <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <h2
                  title={skill.name}
                  className={cn(
                    "min-w-0 break-words font-semibold tracking-tight text-primary transition-all duration-200",
                    scrolled ? "line-clamp-1 text-[17px] leading-6" : "line-clamp-2 text-[22px] leading-7"
                  )}
                >
                  {skill.name}
                </h2>
                {skill.update_status === "update_available" && (
                  <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                    {t("mySkills.detail.badgeUpdateAvailable")}
                  </span>
                )}
              </div>
              {!scrolled && skill.description && (
                <p className="mt-0.5 line-clamp-1 text-[13px] leading-5 text-secondary" title={skill.description}>{skill.description}</p>
              )}
              <div className={cn("flex flex-wrap items-center gap-2 text-[12.5px] leading-4 text-tertiary", scrolled ? "mt-0.5" : "mt-1")}>
                <span className="max-w-full break-words" title={skill.author_source ?? undefined}>
                  {t("mySkills.author")}: {skill.author || t("mySkills.authorMissing")}
                </span>
                {skill.tags.map((tag, index) => (
                  <span
                    key={tag}
                    className={cn("inline-flex items-center rounded px-1.5 py-px text-[11px] font-medium leading-4", index === 0 ? "bg-accent-bg text-accent-dark dark:text-accent-light" : "bg-surface-hover text-secondary")}
                  >
                    {tag}
                  </span>
                ))}
              </div>
              </div>
            </div>
            <div className={cn("skill-detail-actions flex shrink-0 flex-wrap items-center justify-end gap-2", scrolled ? "pt-0" : "pt-0.5")}>
              <button type="button" onClick={() => openComparison("source")} disabled={!supportsSourceDiff}
                title={!supportsSourceDiff ? t("mySkills.detail.noSource") : undefined}
                className={cn("inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface text-secondary outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40", scrolled ? "h-7 px-2 text-[12px]" : "h-8 px-2.5 text-[12.5px]")}>
                {sourceIcon(skill.source_type)}{t("mySkills.detail.viewSource")}
              </button>
              <button type="button" onClick={() => openComparison("diff")} disabled={!supportsSourceDiff}
                title={!supportsSourceDiff ? t("mySkills.detail.noSource") : undefined}
                className={cn("inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface text-secondary outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40", scrolled ? "h-7 px-2 text-[12px]" : "h-8 px-2.5 text-[12.5px]")}>
                <FileDiff className="h-3.5 w-3.5" />{t("mySkills.detail.viewDiff")}
              </button>
              {hasUpdateSource && onUpdate ? (
                <button
                  type="button"
                  onClick={runUpdate}
                  disabled={updateBusy || busyAction === `check:${skill.id}`}
                  className={cn("inline-flex items-center gap-1.5 rounded-md bg-emerald-700 font-medium text-white outline-none hover:bg-emerald-800 focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60", scrolled ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[12.5px]")}
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", updateBusy && "animate-spin")} />
                  {updateBusy ? t("mySkills.detail.updating") : updateLabel}
                </button>
              ) : (
                <span
                  className={cn("inline-flex items-center gap-1.5 rounded-md border border-border-subtle text-muted", scrolled ? "h-7 px-2 text-[12px]" : "h-8 px-2.5 text-[12.5px]")}
                  title={t("mySkills.detail.noSource")}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t("mySkills.detail.noSource")}
                </span>
              )}
              {compact && <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="skill-detail-sidebar-toggle rounded-md border border-border-subtle p-1 text-muted outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
                aria-label={t("mySkills.detail.sidebar")}
              >
                <PanelRightOpen className="h-4 w-4" />
              </button>}
            </div>
          </div>
          {/* 页签层级：文档 / 来源与差异 / 调用记录 */}
          <nav className={cn("flex items-center gap-3.5 border-b border-border-subtle transition-all duration-200", scrolled ? "mt-1" : "mt-2.5")} aria-label={t("mySkills.detail.doc")}>
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
                  if (tab === "sourceDiff") setSourceFocus("diff");
                  // 重新进入调用记录页签时先清空上一次的结果，避免展示过期记录。
                  if (tab === "activity") { setActivityItems(null); setActivityError(""); }
                  mainScrollRef.current?.scrollTo({ top: 0 });
                }}
                aria-current={contentTab === tab ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex items-center border-b-2 px-3 font-medium outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-accent",
                  scrolled ? "h-7 text-[12.5px]" : "h-8 text-[13px]",
                  contentTab === tab
                    ? "border-accent text-accent-dark dark:text-accent-light"
                    : "border-transparent text-muted hover:text-secondary"
                )}
              >
                {label}
              </button>
            ))}
          </nav>
        </header>

        <div className="flex min-h-0 flex-1">
          <main ref={mainScrollRef} tabIndex={-1} inert={drawerOpen && compact} className="skill-detail-main min-h-0 min-w-0 flex-1 overflow-y-auto pl-12 pr-8 py-6 outline-none scrollbar-hide">
            {loading ? (
              <div className="mt-12 text-center text-[13px] text-muted">{t("common.loading")}</div>
            ) : contentTab === "sourceDiff" ? (
              <div className="flex flex-col gap-6">
                <section ref={diffSectionRef} aria-label={t("mySkills.detail.viewDiff")}>
                    <h3 className="mb-2 text-[14px] font-semibold text-primary">{t("mySkills.detail.viewDiff")}</h3>
                {activeSourceDiff ? <SkillSourceDiffViewer entries={activeSourceDiff.entries} /> : sourceDiffLoading ? (
                  <div className="mt-6 text-center text-[13px] text-muted">{t("common.loading")}</div>
                ) : <p className="text-sm text-muted">{t("mySkills.sourceDiffUnavailable")}</p>}
                </section>
                <section ref={sourceSectionRef} aria-label={t("mySkills.detail.viewSource")}>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-[14px] font-semibold text-primary">{t("mySkills.detail.viewSource")}</h3>
                      {(activeSourceDoc || sourceHref) && (
                        <button
                          type="button"
                          onClick={() => void openSourceFile()}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1 text-[12.5px] text-secondary outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          <FolderOpen className="h-3.5 w-3.5" />{t("mySkills.detail.openSourceFile")}
                        </button>
                      )}
                    </div>
                    {sourceOpenError && <p role="alert" className="mb-2 text-[12px] text-danger">{sourceOpenError}</p>}
                    {activeSourceDoc ? <>
                    <p className="mb-3 text-[12.5px] text-muted">
                      {activeSourceDoc.source_label} · {activeSourceDoc.revision.slice(0, 7)}
                    </p>
                    <SkillMarkdown content={activeSourceDoc.content} hideFirstHeading repeatedTitle={skill.name} variant="detail" />
                    </> : <p className="text-sm text-muted">{t(sourceDocLoading ? "common.loading" : "mySkills.sourceDiffUnavailable")}</p>}
                </section>
              </div>
            ) : contentTab === "activity" ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <h3 className="text-[14px] font-semibold text-primary">{t("mySkills.detail.tabActivity")}</h3>
                    <p className="mt-1 text-[12.5px] text-tertiary">{t("mySkills.detail.activityHint")}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { onClose(); navigate(`/skill-activity?skill=${encodeURIComponent(skill.name)}`); }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1 text-[12.5px] text-secondary outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <History className="h-3.5 w-3.5" />{t("mySkills.detail.activityOpenPage")}
                  </button>
                </div>
                <ActivityRecordList
                  items={activityItems ?? []}
                  loading={activityItems === null && !activityError}
                  error={activityError}
                  compact
                  emptyText={t("mySkills.detail.activityEmpty")}
                  onRetry={() => setActivityRevision(value => value + 1)}
                />
              </div>
            ) : activeDoc ? (
              <SkillMarkdown
                content={activeDoc.content}
                headingIdPrefix={tocPrefix}
                hideFirstHeading
                repeatedTitle={skill.name}
                variant="detail"
              />
            ) : (
              <div className="mt-12 text-center text-[13px] text-muted">{t("common.documentMissing")}</div>
            )}
          </main>

          {/* 右侧辅助栏：宽窗口常驻，窄窗口收起为抽屉 */}
          {!compact && <aside className="skill-detail-sidebar flex w-[312px] shrink-0 flex-col overflow-y-auto border-l border-border-subtle bg-background px-6 py-6 scrollbar-hide">
            {sidebar}
          </aside>}
          {drawerOpen && compact && (
            <div className="absolute inset-0 z-20 flex" role="dialog" aria-modal="true" aria-label={t("mySkills.detail.sidebar")}>
              <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
              <div ref={drawerRef} className="relative ml-auto flex w-[312px] max-w-[85%] flex-col overflow-y-auto border-l border-border-subtle bg-surface px-6 py-6">
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="self-end rounded-md p-1.5 text-muted outline-none hover:bg-surface-hover hover:text-secondary focus-visible:outline focus-visible:outline-accent"
                  aria-label={t("mySkills.detail.closeSidebar")}
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

function SidebarSection({ icon, title, children }: { icon: ReactNode; title: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-border-subtle pb-6 mb-6 last:mb-0 last:border-b-0">
      <h3 className="mb-3 flex items-center gap-2.5 text-[15px] font-semibold leading-6 text-primary">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}
