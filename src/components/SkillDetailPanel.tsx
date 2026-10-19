import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ChevronDown, Github, HardDrive, Globe, ArrowLeft,
  ListTree, Boxes, Link2, Info, PanelRightOpen, RefreshCw, History, Layers, FileDiff,
  FolderTree, FolderOpen, Pencil,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../utils";
import {
  getSkillDocument,
  getSkillSourcePreview,
  openPath,
  type ManagedSkill,
  type Project,
  type SkillDocument,
  type SkillSourcePreview,
  type SkillToolToggle,
  type ToolInfo,
} from "../lib/tauri";
import { SkillSourceDiffViewer } from "./SkillSourceDiffViewer";
import { SkillMarkdown } from "./SkillMarkdown";
import { SkillTranslationControls, SkillTranslationReader, TRANSLATION_EDITOR_EVENT, type SkillTranslationState } from "./SkillTranslationReader";
import { useSkillTranslation } from "../hooks/useSkillTranslation";
import { resolveDocumentLanguage, type DocumentLanguage } from "../lib/skillTranslation";
import { extractHeadings } from "../lib/markdownOutline";
import { getErrorMessage } from "../lib/error";
import { skillRepoUrl, repoLabel } from "../lib/skillRepo";
import { AgentIcon } from "./AgentIcon";
import { ToggleSwitch } from "./ToggleSwitch";
import { SkillProjectsSection } from "./SkillProjectsSection";
import { SkillStructureSection } from "./SkillStructureSection";
import { ActivityRecordList } from "./ActivityRecordList";
import { openExternal } from "../lib/desktop";
import { getActivity, type ActivityEvent } from "../lib/activity";
import { useDialogFocus } from "../hooks/useDialogFocus";

type ContentTab = "doc" | "sourceDiff" | "activity";
type SidebarTab = "toc" | "structure" | "source";

/** 一次读取失败的快照：带上「哪一次尝试」的 key，重跑之后旧失败自动失效（不用清 state）。 */
interface SourceFailure {
  key: string;
  message: string;
}

/** 来源区块的读取失败：给出原因和重试入口，而不是留一句「暂时无法读取」让用户重开详情。 */
function SourceLoadFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-l-2 border-danger bg-danger-bg px-2.5 py-2">
      <p role="alert" className="min-w-0 break-words text-[12.5px] leading-5 text-danger">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border-subtle bg-surface px-2.5 py-1 text-[12.5px] text-secondary outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
      >
        <RefreshCw className="h-3.5 w-3.5" />{t("common.retry")}
      </button>
    </div>
  );
}

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
  /** 打开"编辑技能信息"对话框（别名／自定义说明／作者）。 */
  onEditProfile?: (skill: ManagedSkill) => void;
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
  onEditProfile,
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
      onEditProfile={onEditProfile}
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
  onEditProfile?: (skill: ManagedSkill) => void;
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
  onEditProfile,
}: ContentProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [doc, setDoc] = useState<SkillDocument | null>(null);
  const [sourcePreview, setSourcePreview] = useState<SkillSourcePreview | null>(null);
  const [sourceFailure, setSourceFailure] = useState<SourceFailure | null>(null);
  const [sourceRefreshing, setSourceRefreshing] = useState(false);
  const [sourceReloadToken, setSourceReloadToken] = useState(0);
  const [sourceFocus, setSourceFocus] = useState<"source" | "diff">("diff");
  const [loading, setLoading] = useState(true);
  const toggleSection = (key: string) => setCollapsedSections(current => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const [contentTab, setContentTab] = useState<ContentTab>("doc");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("toc");
  const sidebarId = useId();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // 右栏区块折叠状态：默认收起"部署到工具"与来源区块内的"来源详情"，
  // 其余按需收起——这样首屏只看到一行来源摘要，不会被长路径和 6 条元数据顶满。
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set<string>(["deploy", "sourceDetails"]));
  // 项目结构的文件总数，用于在区块标题右侧显示计数角标（由子组件回传）。
  const [structureFileCount, setStructureFileCount] = useState<number | null>(null);
  const handleStructureFileCount = useCallback((count: number | null) => setStructureFileCount(count), []);
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
  const forceSourceRefreshRef = useRef(false);
  const skillId = skill.id;
  // 详情覆盖原页面，关闭后焦点回到入口，调用记录的筛选、分页和滚动保持原样。
  useDialogFocus(true, shellRef, onClose);
  const tocPrefix = `skill-${skill.id}`;
  const supportsSourceDiff =
    skill.source_type === "git"
    || skill.source_type === "skillssh"
    || ((skill.source_type === "local" || skill.source_type === "import") && !!skill.source_ref);
  const localDocVersion = `${skill.id}:${skill.updated_at}`;
  const translationState = useSkillTranslation(skill.id, localDocVersion);
  const [languageChoice, setLanguageChoice] = useState<DocumentLanguage | null>(null);
  const documentLanguage = resolveDocumentLanguage(languageChoice, translationState.translation);
  // 编辑器开合放在面板这层：按钮在页签行，编辑器仍渲染正文顶部。
  const [translationDraftOpen, setTranslationDraftOpen] = useState(false);
  const sourceDocVersion = [
    skill.id,
    skill.source_type,
    skill.source_ref ?? "",
    skill.source_ref_resolved ?? "",
    skill.source_branch ?? "",
    skill.source_subpath ?? "",
    skill.source_revision ?? "",
    skill.remote_revision ?? "",
  ].join(":");
  /** 来源版本 + 重试次数：失败信息只属于那一次尝试，重跑之后旧失败自动失效。 */
  const sourceAttemptKey = `${sourceDocVersion}#${sourceReloadToken}`;

  /** 切换正文语言：正文回到顶部，当前小节高亮清空（两种语言的标题行号不同）。 */
  function chooseDocumentLanguage(language: DocumentLanguage) {
    if (language === documentLanguage) return;
    // 切换语言保持当前阅读位置：不回到顶部，也不清空当前小节高亮——
    // 两种语言是同一份文档的不同译本，标题结构一致，滚动位置本来就有意义。
    setLanguageChoice(language);
  }

  // 页签行的「编辑 / 添加中文版」按钮只发事件：编辑器在正文顶部，滚动到那里才看得到内容。
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ skillId?: string }>).detail;
      if (detail?.skillId !== skill.id) return;
      setContentTab("doc");
      setTranslationDraftOpen(true);
      mainScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    };
    document.addEventListener(TRANSLATION_EDITOR_EVENT, onOpen);
    return () => document.removeEventListener(TRANSLATION_EDITOR_EVENT, onOpen);
  }, [skill.id]);

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
    // 原文与差异使用同一次来源读取；进入页签时由服务端检查缓存有效期。
    if (contentTab !== "sourceDiff" || !supportsSourceDiff) return;
    sourceRequestIdRef.current += 1;
    const requestId = sourceRequestIdRef.current;
    let current = true;
    const forceRefresh = forceSourceRefreshRef.current;
    forceSourceRefreshRef.current = false;

    getSkillSourcePreview(skillId, forceRefresh)
      .then((nextPreview) => {
        if (!current || requestId !== sourceRequestIdRef.current) return;
        setSourcePreview(nextPreview);
        setSourceFailure(null);
      })
      .catch((cause: unknown) => {
        if (!current || requestId !== sourceRequestIdRef.current) return;
        // 刷新失败时保留上次成功预览，但本次错误始终可见。
        setSourceFailure({
          key: sourceAttemptKey,
          message: getErrorMessage(cause, t("mySkills.sourceDiffLoadFailed")),
        });
      })
      .finally(() => {
        if (current && requestId === sourceRequestIdRef.current) setSourceRefreshing(false);
      });
    return () => { current = false; };
  }, [contentTab, skillId, sourceAttemptKey, supportsSourceDiff, t]);

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
  const activeSourcePreview = sourcePreview?.skill_id === skill.id ? sourcePreview : null;
  const activeSourceDoc = activeSourcePreview?.document ?? null;
  const activeSourceDiff = activeSourcePreview?.diff ?? null;
  // 失败信息只在「本次尝试」上成立：换了版本或点了重试，旧的失败自动退回加载中。
  const sourceError = sourceFailure?.key === sourceAttemptKey ? sourceFailure.message : "";
  const sourceDiffLoading =
    contentTab === "sourceDiff" && supportsSourceDiff && !activeSourceDiff && !sourceError;

  useEffect(() => {
    if (contentTab !== "sourceDiff") return;
    const section = sourceFocus === "source" ? sourceSectionRef.current : diffSectionRef.current;
    section?.scrollIntoView({ block: "start" });
  }, [contentTab, sourceFocus, activeSourceDoc, activeSourceDiff]);

  function openComparison(target: "source" | "diff") {
    setSourceFocus(target);
    setSourceRefreshing(true);
    setSourceReloadToken(value => value + 1);
    setContentTab("sourceDiff");
    const section = target === "source" ? sourceSectionRef.current : diffSectionRef.current;
    section?.scrollIntoView({ block: "start" });
  }

  /** 显式刷新／重试绕过成功缓存，同时重新获取原文与差异。 */
  function retrySource() {
    forceSourceRefreshRef.current = true;
    setSourceRefreshing(true);
    setSourceReloadToken(value => value + 1);
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

  // 本地导入的技能自身不带远程来源（sourceLabel 只会显示本机路径），这里补上它在 GitHub 上的
  // 上游仓库 —— 只显示**逐个核对过内容**的那些（见 lib/skillRepo.ts），核不出来就整行不显示。
  // 远程来源的技能已经由上方「打开来源网页」承担同一件事，不再重复一行。
  const repoUrl = sourceHref ? null : skillRepoUrl(skill);

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

  // 打开上游 GitHub 仓库（本地导入技能补的那一行）。
  async function openRepo() {
    if (!repoUrl) return;
    setSourceOpenError("");
    try { await openExternal(repoUrl); }
    catch (error) { setSourceOpenError(String(error instanceof Error ? error.message : error)); }
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
  const readingContent = documentLanguage === "zh-CN" ? translationState.translation?.content : activeDoc?.content;
  const headings = useMemo(
    () => (readingContent ? extractHeadings(readingContent, { skipFirst: true, repeatedTitle: skill.name }) : []),
    [readingContent, skill.name]
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
    <SidebarSection
      icon={<ListTree className="h-4 w-4" />}
      title={t("mySkills.detail.toc")}
      trailing={headings.length > 0 ? String(headings.length) : undefined}
      collapsed={collapsedSections.has("toc")}
      onToggle={() => toggleSection("toc")}
    >
      {headings.length === 0 ? (
        <p className="px-1 py-1 text-[12px] text-tertiary">{t("mySkills.detail.tocEmpty")}</p>
      ) : (
        <nav className="flex max-h-[min(55vh,480px)] flex-col overflow-y-auto scrollbar-hide" aria-label={t("mySkills.detail.toc")}>
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
    <SidebarSection
      icon={<Boxes className="h-4 w-4" />}
      title={t("mySkills.detail.deployToTools")}
      trailing={t("mySkills.enabledSummary", { enabled: enabledAvailableCount, total: availableItems.length })}
      collapsed={collapsedSections.has("deploy")}
      onToggle={() => toggleSection("deploy")}
    >
      {availableItems.length === 0 ? (
        <p className="px-1 py-1 text-[12px] text-tertiary">{t("mySkills.detail.deployNone")}</p>
      ) : (
        <div className="flex flex-col">
          {availableItems.map(item => (
            <div key={item.key} className="flex min-h-[34px] min-w-0 items-center gap-3" title={tools?.find(tool => tool.key === item.key)?.skills_dir}>
              <AgentIcon agentKey={item.key} displayName={item.displayName} className="skill-detail-agent-icon h-[18px] w-[18px]" />
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-secondary">{item.displayName}</span>
              <ToggleSwitch checked={item.enabled} disabled={item.disabled} loading={togglingTool === item.key}
                onChange={() => onToggleTool(item.key, !item.enabled)} title={item.displayName} className="mr-1 scale-110" />
            </div>
          ))}
        </div>
      )}
    </SidebarSection>
  ) : null;

  const structureSection = (
    <SidebarSection
      icon={<FolderTree className="h-4 w-4" />}
      title={t("mySkills.detail.structure")}
      trailing={structureFileCount != null ? t("mySkills.detail.structureCount", { count: structureFileCount }) : undefined}
      collapsed={collapsedSections.has("structure")}
      onToggle={() => toggleSection("structure")}
    >
      <SkillStructureSection
        skillId={skill.id}
        version={localDocVersion}
        onFileCount={handleStructureFileCount}
      />
    </SidebarSection>
  );

  const projectsSection = projects && projects.length > 0 ? (
    <SidebarSection icon={<Link2 className="h-4 w-4" />} title={t("mySkills.detail.projects")}>
      <SkillProjectsSection
        skill={skill}
        projects={projects}
        onChanged={onProjectsChanged}
      />
    </SidebarSection>
  ) : null;

  // 来源信息：区块整体可折叠；区块内"来源详情"（6 条元数据）默认收起，
  // 常驻只留一行来源摘要与"打开来源"入口，避免长路径把右栏顶满。
  const sourceInfo = (
    <SidebarSection
      icon={<Info className="h-4 w-4" />}
      title={t("mySkills.detail.sourceInfo")}
      collapsed={collapsedSections.has("source")}
      onToggle={() => toggleSection("source")}
    >
      <div className="flex flex-col gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[13px] text-tertiary">
          {sourceLabel
            ? <span className="min-w-0 flex-1 break-words" title={sourceLabel}>{sourceLabel}</span>
            : <span className="min-w-0 flex-1 text-faint">{t("mySkills.detail.sourceSummaryEmpty")}</span>}
        </div>
        {repoUrl && (
          <button
            type="button"
            onClick={() => void openRepo()}
            title={t("mySkills.detail.openRepo", { repo: repoLabel(repoUrl) })}
            className="inline-flex w-fit items-center gap-1.5 rounded-md text-[12.5px] text-accent-dark outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent dark:text-accent-light"
          >
            <Github className="h-3.5 w-3.5" />
            {repoLabel(repoUrl)}
          </button>
        )}
        {canOpenSourceLocation && (
          <button
            type="button"
            onClick={() => void openSourceLocation()}
            className="inline-flex w-fit items-center gap-1.5 rounded-md text-[12.5px] text-accent-dark outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent dark:text-accent-light"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t(localSourceLocation ? "mySkills.detail.openSourceFolder" : "mySkills.detail.openSourceLink")}
          </button>
        )}
        {sourceOpenError && <p role="alert" className="text-[12px] text-danger">{sourceOpenError}</p>}
        {metadataItems.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => toggleSection("sourceDetails")}
              aria-expanded={!collapsedSections.has("sourceDetails")}
              className="inline-flex w-fit items-center gap-1 rounded-md text-[12px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ChevronDown className={cn("h-3 w-3 transition-transform", collapsedSections.has("sourceDetails") && "-rotate-90")} />
              {t("mySkills.detail.sourceDetails")}
            </button>
            {!collapsedSections.has("sourceDetails") && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11.5px] leading-4">
                {metadataItems.map((item) => (
                  <Fragment key={item.label}>
                    <dt className="whitespace-nowrap text-faint">{item.label}</dt>
                    <dd className="min-w-0 break-all font-mono text-secondary">{item.value}</dd>
                  </Fragment>
                ))}
              </dl>
            )}
          </>
        )}
      </div>
    </SidebarSection>
  );

  const sidebarTabs: { key: SidebarTab; label: string; disabled?: boolean }[] = [
    { key: "toc", label: t("mySkills.detail.toc"), disabled: contentTab !== "doc" },
    { key: "structure", label: t("mySkills.detail.structure") },
    { key: "source", label: t("mySkills.detail.sidebarSource") },
  ];
  // 非文档页不显示无法定位正文的目录；回到文档时保留之前的侧栏选择。
  const activeSidebarTab = sidebarTab === "toc" && contentTab !== "doc" ? "structure" : sidebarTab;
  const sidebar = (
    <>
      <div role="tablist" aria-label={t("mySkills.detail.sidebar")} className="mb-3 flex shrink-0 gap-1 rounded-lg bg-surface-hover p-1">
        {sidebarTabs.map(tab => <button key={tab.key} type="button" role="tab" id={`${sidebarId}-tab-${tab.key}`}
          aria-selected={activeSidebarTab === tab.key} aria-controls={`${sidebarId}-panel`} disabled={tab.disabled}
          tabIndex={activeSidebarTab === tab.key ? 0 : -1}
          onClick={() => setSidebarTab(tab.key)}
          onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const available = sidebarTabs.filter(item => !item.disabled);
            const index = available.findIndex(item => item.key === tab.key);
            const next = event.key === "Home" ? available[0] : event.key === "End" ? available.at(-1)!
              : available[(index + (event.key === "ArrowRight" ? 1 : -1) + available.length) % available.length];
            setSidebarTab(next.key);
            document.getElementById(`${sidebarId}-tab-${next.key}`)?.focus();
          }}
          className={cn("min-w-0 flex-1 whitespace-nowrap rounded-md px-1 py-1.5 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40", activeSidebarTab === tab.key ? "bg-surface font-medium text-primary shadow-sm" : "text-tertiary hover:text-secondary")}
        >{tab.label}</button>)}
      </div>
      <div role="tabpanel" id={`${sidebarId}-panel`} aria-labelledby={`${sidebarId}-tab-${activeSidebarTab}`} tabIndex={0} className="min-w-0 rounded outline-none focus-visible:ring-2 focus-visible:ring-accent">
        {activeSidebarTab === "toc" ? toc : activeSidebarTab === "structure" ? structureSection : sourceInfo}
      </div>
      {deploySection}
      {projectsSection}
    </>
  );

  return createPortal(
    <div className="fixed top-[28px] right-0 bottom-0 left-[220px] z-40 isolate">
      <div
        className="absolute inset-0 z-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div ref={shellRef} role="dialog" aria-modal="true" aria-label={skill.display_name || skill.name} tabIndex={-1} className="skill-detail-shell absolute inset-0 z-10 flex min-h-0 flex-col overflow-hidden border-l border-border-subtle bg-surface outline-none">
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
                {/* 详情是全局弹层，从哪打开就关回哪：在技能库页叫「返回技能库」，
                    从调用记录 / 工作台打开时只是个关闭动作，写「返回技能库」会让人以为会跳走。 */}
                {location.pathname === "/skill-activity" ? t("activity.backToRecords") : location.pathname === "/my-skills" ? t("mySkills.detail.back") : t("mySkills.detail.backGeneric")}
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
                  {skill.display_name || skill.name}
                </h2>
                {skill.alias && (
                  <span className="rounded border border-border-subtle bg-surface-hover px-1.5 py-px text-[11px] leading-4 text-tertiary" title={`${t("mySkills.detail.aliasLabel")}: ${skill.name}`}>
                    {t("mySkills.detail.aliasLabel")}: {skill.name}
                  </span>
                )}
                {skill.update_status === "update_available" && (
                  <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                    {t("mySkills.detail.badgeUpdateAvailable")}
                  </span>
                )}
                {onEditProfile && (
                  <button
                    type="button"
                    onClick={() => onEditProfile(skill)}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-muted outline-none hover:bg-surface-hover hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
                    title={t("mySkills.profile.title")}
                  >
                    <Pencil className="h-3 w-3" />{t("mySkills.detail.editProfile")}
                  </button>
                )}
              </div>
              {!scrolled && (skill.display_description || skill.description) && (
                <p className="mt-0.5 line-clamp-1 text-[13px] leading-5 text-secondary" title={skill.display_description ?? undefined}>{skill.display_description || skill.description}</p>
              )}
              <div className={cn("flex flex-wrap items-center gap-2 text-[12.5px] leading-4 text-tertiary", scrolled ? "mt-0.5" : "mt-1")}>
                <span className="max-w-full break-words" title={skill.display_author_source ?? undefined}>
                  {t("mySkills.author")}: {skill.display_author || t("mySkills.authorMissing")}
                  {skill.author_override ? ` · ${t("mySkills.profile.custom")}` : ""}
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
          {/* 页签层级：文档 / 来源与差异 / 调用记录；行尾右侧是文档语言切换与编辑入口 */}
          <div className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-border-subtle transition-all duration-200", scrolled ? "mt-1" : "mt-2.5")}>
          <nav className="flex min-w-0 flex-wrap items-center gap-3.5" aria-label={t("mySkills.detail.doc")}>
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
                  // 切走文档页签时收起编辑器，回来重新点按钮即可。
                  if (tab !== "doc") setTranslationDraftOpen(false);
                  if (tab === "sourceDiff") {
                    setSourceFocus("diff");
                    setSourceRefreshing(true);
                    setSourceReloadToken(value => value + 1);
                  }
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
          {activeDoc && (
            <SkillTranslationControls
              skillId={skill.id}
              state={translationState as SkillTranslationState}
              language={documentLanguage}
              disabled={contentTab !== "doc"}
              onLanguageChange={chooseDocumentLanguage}
            />
          )}
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <main ref={mainScrollRef} tabIndex={-1} inert={drawerOpen && compact} className="skill-detail-main min-h-0 min-w-0 flex-1 overflow-y-auto pl-12 pr-8 py-6 outline-none scrollbar-hide">
            {loading ? (
              <div className="mt-12 text-center text-[13px] text-muted">{t("common.loading")}</div>
            ) : contentTab === "sourceDiff" ? (
              <div className="flex flex-col gap-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[12.5px] text-muted" aria-live="polite">
                    {activeSourcePreview
                      ? t("mySkills.sourcePreviewCachedAt", { defaultValue: "读取时间：{{time}}", time: new Date(activeSourcePreview.cached_at).toLocaleString(i18n.language) })
                      : t("mySkills.detail.tabSourceDiff")}
                  </p>
                  <button
                    type="button"
                    onClick={retrySource}
                    disabled={sourceRefreshing}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1 text-[12.5px] text-secondary outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-50"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", sourceRefreshing && "animate-spin")} />
                    {sourceRefreshing ? t("common.loading") : t("mySkills.sourcePreviewRefresh", { defaultValue: "刷新来源" })}
                  </button>
                </div>
                {sourceError && <SourceLoadFailure message={sourceError} onRetry={retrySource} />}
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
                    </> : <p className="text-sm text-muted">{sourceError ? t("mySkills.sourceDiffUnavailable") : t("common.loading")}</p>}
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
              <SkillTranslationReader
                skillId={skill.id}
                original={activeDoc.content}
                translation={translationState.translation}
                language={documentLanguage}
                loading={translationState.loading}
                error={translationState.error}
                draftOpen={translationDraftOpen}
                onDraftClose={() => setTranslationDraftOpen(false)}
                onLanguageChange={chooseDocumentLanguage}
                reload={translationState.reload}
                accept={translationState.accept}
                onSaved={translationState.accept}
                headingIdPrefix={tocPrefix}
                repeatedTitle={skill.name}
              />
            ) : (
              <div className="mt-12 text-center text-[13px] text-muted">{t("common.documentMissing")}</div>
            )}
          </main>

          {/* 右侧辅助栏：宽窗口常驻，窄窗口收起为抽屉 */}
          {!compact && <aside className="skill-detail-sidebar flex w-[340px] shrink-0 flex-col overflow-y-auto border-l border-border-subtle bg-background px-5 py-5 scrollbar-hide">
            {sidebar}
          </aside>}
          {drawerOpen && compact && (
            <div className="absolute inset-0 z-20 flex" role="dialog" aria-modal="true" aria-label={t("mySkills.detail.sidebar")}>
              <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
              <div ref={drawerRef} className="relative ml-auto flex w-[340px] max-w-[85%] flex-col overflow-y-auto border-l border-border-subtle bg-surface px-5 py-5">
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

function SidebarSection({ icon, title, trailing, collapsed, onToggle, children }: {
  icon: ReactNode;
  title: ReactNode;
  /** 标题右侧的计数等次要信息。 */
  trailing?: ReactNode;
  collapsed?: boolean;
  /** 传入后标题成为可折叠开关；右栏因此可以只保留当前关心的区块。 */
  onToggle?: () => void;
  children: ReactNode;
}) {
  const header = (
    <>
      <span className="shrink-0 text-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-5 text-primary">{title}</span>
      {trailing != null && <span className="shrink-0 text-[11px] font-normal text-muted">{trailing}</span>}
      {onToggle && <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted transition-transform", collapsed && "-rotate-90")} />}
    </>
  );
  return (
    <section className="border-b border-border-subtle py-3.5 first:pt-0 last:border-b-0 last:pb-0">
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex w-full items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {header}
        </button>
      ) : (
        <h3 className="flex items-center gap-2.5">{header}</h3>
      )}
      {!collapsed && <div className="mt-2">{children}</div>}
    </section>
  );
}
