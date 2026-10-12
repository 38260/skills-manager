import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { History, RefreshCw, Square, ChevronLeft, ChevronRight, Search, Settings2, AlertTriangle } from "lucide-react";
import { useApp } from "../context/AppContext";
import { listen } from "../lib/transport";
import { cn } from "../utils";
import * as api from "../lib/activity";
import { ActivityTable } from "../components/ActivityTable";
import { ActivityDetailPanel } from "../components/ActivityDetailPanel";

const field = "min-w-0 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-[13px] text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent";
const button = "inline-flex items-center justify-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-[13px] text-secondary outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40";
// 每页条数：列表是表格形态，一条一行；50 行会把页面撑到三千多像素，
// 窄窗口下详情栏被顶到很远的地方。20 行既够扫、又能让详情与列表同屏。
const pageSize = 20;
// 扫描进度通知的刷新节流：后端约 250ms 推一次，节流到这里不会漏掉最终结果（另有 5s 兜底定时）。
const ACTIVITY_REFRESH_THROTTLE_MS = 1200;
const initialFilters = { tool: "", kind: "", trigger: "", status: "", skillName: "", project: "", from: "", to: "" };
type Filters = typeof initialFilters;

function SourceEditor({ source, running, onSaved }: { source: api.ActivitySource; running: boolean; onSaved: () => void }) {
  const { t, i18n } = useTranslation();
  const [path, setPath] = useState(source.path);
  const [enabled, setEnabled] = useState(source.enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const id = `activity-source-${source.tool}`;
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try { await api.configureActivitySource(source.tool, path, enabled); onSaved(); }
    catch (cause) { setError(String(cause instanceof Error ? cause.message : cause)); }
    finally { setSaving(false); }
  }
  return <form onSubmit={save} className="border-t border-border-subtle py-3 first:border-t-0">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[13px]">
      <label htmlFor={id} className="font-medium text-primary">{api.toolNames[source.tool]}</label>
      <span className={cn("text-[12px]", ["partial", "missing", "denied", "error"].includes(source.state) ? "text-amber-600 dark:text-amber-400" : "text-tertiary")}>
        {t(`activity.sourceStates.${source.state}`, { defaultValue: source.state })}
        {source.state === "scanning" && ` · ${source.processed}/${source.files}`}
        {source.errors > 0 && ` · ${t("activity.issues", { count: source.errors })}`}
      </span>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <input id={id} value={path} onChange={event => setPath(event.target.value)} disabled={running || saving}
        className={cn(field, "flex-1 basis-64 font-mono text-[12px]")} required />
      <label className="flex items-center gap-2 text-[13px] text-secondary"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} disabled={running || saving} />{t("activity.enabled")}</label>
      <button className={button} disabled={running || saving}>{t(saving ? "activity.saving" : "activity.save")}</button>
    </div>
    <p className="mt-2 text-[12px] text-tertiary">{t("activity.lastScan")}: {source.lastScan ? new Date(source.lastScan).toLocaleString(i18n.language) : t("activity.never")}</p>
    {source.detail && <p className="mt-1 text-[12px] text-amber-600 dark:text-amber-400">{source.detail}</p>}
    {error && <p role="alert" className="mt-1 text-[12px] text-danger">{error}</p>}
  </form>;
}

export function SkillActivity() {
  const { t } = useTranslation();
  const { openSkillDetailById } = useApp();
  // 详情页"调用记录"页签通过 /skill-activity?skill=名称 深链进入并预填筛选。
  const [searchParams] = useSearchParams();
  const deepLinkSkill = searchParams.get("skill") ?? "";
  const [filters, setFilters] = useState<Filters>({ ...initialFilters, skillName: deepLinkSkill });
  // 常驻条件：技能搜索、工具、触发方式、记录类型、结果；低频条件收进"更多筛选"（项目、日期）。
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const activeFilterCount = Object.values(filters).filter(value => value !== "").length;
  const [query, setQuery] = useState<api.ActivityQuery>({ page: 1, pageSize, skillName: deepLinkSkill });
  const [result, setResult] = useState<api.ActivityResult | null>(null);
  const [sources, setSources] = useState<api.ActivitySource[]>([]);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<api.ActivityEvent | null>(null);
  const detailRef = useRef<HTMLElement | null>(null);
  const refresh = () => setRevision(value => value + 1);

  // 窄窗口（<1024px）详情在列表下方，选中后把它带进视野。用 "nearest" 只滚最小距离：
  // 用 "start" 会把详情顶到视口最顶部，看起来像「详情跑到上面去了」（用户反馈的原话）。
  // ≥1024px 两栏并排，详情本来就在旁边，不滚动。
  function selectRecord(record: api.ActivityEvent) {
    setSelected(record);
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    detailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  useEffect(() => {
    let current = true;
    Promise.all([api.getActivity(query), api.getActivitySources()]).then(([data, status]) => {
      if (!current) return;
      setResult(data); setSources(status.sources); setRunning(status.running); setError(""); setLoading(false);
    }).catch(cause => { if (current) { setError(String(cause instanceof Error ? cause.message : cause)); setLoading(false); } });
    return () => { current = false; };
  }, [query, revision]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // 扫描进行中后端约每 250ms 推一次进度，原来每次推送都整页重查（记录列表 + 来源），
    // 页面会持续发烫。节流到 1.2s 一次；另有 5s 定时兜底，扫描结束后一定会收敛到最新结果。
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; setRevision(value => value + 1); }, ACTIVITY_REFRESH_THROTTLE_MS);
    };
    void listen("skill-activity-changed", schedule).then(stop => {
      if (disposed) stop(); else unlisten = stop;
    }).catch(() => { /* 定时刷新可覆盖通知连接中断。 */ });
    const interval = setInterval(() => setRevision(value => value + 1), 5000);
    return () => {
      disposed = true;
      unlisten?.();
      clearInterval(interval);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // 右侧详情跟随列表：换页/换筛选后若选中项已不在本页，自动落到第一条。
  useEffect(() => {
    setSelected(current => {
      const items = result?.items ?? [];
      if (current && items.some(item => item.id === current.id)) return current;
      return items[0] ?? null;
    });
  }, [result]);

  async function scan() {
    setBusy(true);
    try { const status = running ? await api.cancelActivityScan() : await api.scanActivity(); setRunning(status.running); refresh(); }
    catch (cause) { setError(String(cause instanceof Error ? cause.message : cause)); }
    finally { setBusy(false); }
  }

  /** 把界面筛选条件转成查询；日期终点按"含当天"处理。 */
  function buildQuery(next: Filters, page = 1, from = next.from, to = next.to): api.ActivityQuery {
    const start = from ? new Date(`${from}T00:00:00`).getTime() : undefined;
    const end = to ? new Date(`${to}T00:00:00`) : null;
    if (end) end.setDate(end.getDate() + 1);
    return {
      page, pageSize,
      tool: next.tool as api.ActivityQuery["tool"], kind: next.kind as api.ActivityQuery["kind"],
      trigger: next.trigger as api.ActivityQuery["trigger"], status: next.status as api.ActivityQuery["status"],
      skillName: next.skillName.trim(), project: next.project.trim(), from: start, to: end?.getTime(),
    };
  }

  function apply(event: FormEvent) {
    event.preventDefault();
    const start = filters.from ? new Date(`${filters.from}T00:00:00`).getTime() : undefined;
    const end = filters.to ? new Date(`${filters.to}T00:00:00`) : null;
    if (end) end.setDate(end.getDate() + 1);
    if (start !== undefined && end !== null && start >= end.getTime()) { setError(t("activity.invalidDates")); return; }
    setLoading(true);
    setQuery(buildQuery(filters));
  }
  const change = (key: keyof Filters, value: string) => setFilters(current => ({ ...current, [key]: value }));
  // 记录类型页签与统计条联动：点页签即按该类型筛（连同已填的其余条件）。
  const pickKind = (kind: string) => {
    const next = { ...filters, kind };
    setFilters(next);
    setLoading(true);
    setQuery(buildQuery(next));
  };
  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const problems = sources.filter(source => source.enabled && ["partial", "missing", "denied", "error"].includes(source.state));
  const enabledSourceCount = sources.filter(source => source.enabled).length;
  const stats = [
    { key: "total", label: t("activity.statsAll"), value: result?.total },
    { key: "invocation", label: t("activity.kinds.invocation"), value: result?.counts.invocation },
    { key: "document", label: t("activity.kinds.document"), value: result?.counts.document },
    { key: "request", label: t("activity.kinds.request"), value: result?.counts.request },
  ];
  const kindTabs = useMemo(() => ([
    { key: "", label: t("activity.statsAll"), count: result?.total ?? 0 },
    { key: "invocation", label: t("activity.kinds.invocation"), count: result?.counts.invocation ?? 0 },
    { key: "document", label: t("activity.kinds.document"), count: result?.counts.document ?? 0 },
    { key: "request", label: t("activity.kinds.request"), count: result?.counts.request ?? 0 },
  ]), [result, t]);
  const emptyText = t(problems.length ? "activity.checkSources" : "activity.empty");

  return <div className="app-page">
    {/* 页头：标题与扫描操作 */}
    <header className="app-page-header flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="app-page-title flex items-center gap-2"><History className="h-4 w-4 text-accent" />{t("activity.title")}</h1>
        <p className="app-page-subtitle">{t("activity.subtitle")}</p>
      </div>
      <button type="button" onClick={() => void scan()} disabled={busy} className={cn(button, "shrink-0 bg-surface")}>
        {running ? <Square className="h-3.5 w-3.5" /> : <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />}
        {t(running ? "activity.stop" : "activity.refresh")}
      </button>
    </header>

    {error && <div role="alert" className="flex items-center justify-between gap-3 border-l-2 border-danger bg-danger-bg px-3 py-2 text-[13px] text-danger"><span>{error}</span><button className={button} onClick={refresh}>{t("activity.retry")}</button></div>}

    {/* 统计：四项紧凑横向排列，紧邻口径说明 */}
    <section aria-label={t("activity.summary")}>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border-subtle bg-border-subtle sm:grid-cols-4">
        {stats.map(stat => <div key={stat.key} className="bg-surface px-4 py-3">
          <div className="text-[12px] text-tertiary">{stat.label}</div>
          <div className="mt-0.5 text-[22px] font-semibold tabular-nums leading-7 text-primary">{stat.value ?? "—"}</div>
        </div>)}
      </div>
      <p className="mt-2 text-[12px] leading-5 text-tertiary">{t("activity.countNote")}</p>
    </section>

    {/* 日志来源：一行摘要 + 展开编辑 */}
    <section className="app-panel">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
        <h2 className="text-[13px] font-semibold text-secondary">{t("activity.sources")}</h2>
        <span aria-live="polite" className="text-[12px] text-tertiary">
          {running ? t("activity.scanning") : t("activity.sourceSummary", { count: enabledSourceCount })}
        </span>
        {problems.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[12px] text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />{t("activity.sourceProblems", { count: problems.length })}
          </span>
        )}
        <button
          type="button"
          onClick={() => setSourcesOpen(value => !value)}
          aria-expanded={sourcesOpen}
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-muted outline-none transition-colors hover:bg-surface-hover hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Settings2 className="h-3.5 w-3.5" />
          {sourcesOpen ? t("activity.hideFilters") : t("activity.manageSources")}
        </button>
      </div>
      {sourcesOpen && (
        <div className="border-t border-border-subtle px-4 pb-1">
          <p className="py-3 text-[12px] leading-relaxed text-tertiary">{t("activity.sourceHelp")}</p>
          {sources.map(source => <SourceEditor key={`${source.tool}:${source.path}:${source.enabled}`} source={source} running={running} onSaved={refresh} />)}
        </div>
      )}
    </section>

    {/* 筛选：常驻搜索 + 工具 / 触发方式 / 类型 / 结果，"更多筛选"承载项目与日期 */}
    <form onSubmit={apply} className="app-panel px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            value={filters.skillName}
            onChange={e => change("skillName", e.target.value)}
            className={cn(field, "w-full pl-9")}
            placeholder={t("activity.skillSearch")}
            aria-label={t("activity.skill")}
          />
        </div>
        <select value={filters.tool} onChange={e => change("tool", e.target.value)} className={cn(field, "w-auto shrink-0")} aria-label={t("activity.tool")}>
          <option value="">{t("activity.allTools")}</option>
          {api.activityTools.map(tool => <option key={tool} value={tool}>{api.toolNames[tool]}</option>)}
        </select>
        <select value={filters.trigger} onChange={e => change("trigger", e.target.value)} className={cn(field, "w-auto shrink-0")} aria-label={t("activity.trigger")}>
          <option value="">{t("activity.allTriggers")}</option>
          {(["manual", "automatic", "unknown"] as const).map(trigger => <option key={trigger} value={trigger}>{t(`activity.triggers.${trigger}`)}</option>)}
        </select>
        <select value={filters.kind} onChange={e => change("kind", e.target.value)} className={cn(field, "w-auto shrink-0")} aria-label={t("activity.kind")}>
          <option value="">{t("activity.allKinds")}</option>
          {(["invocation", "document", "request"] as const).map(kind => <option key={kind} value={kind}>{t(`activity.kinds.${kind}`)}</option>)}
        </select>
        <select value={filters.status} onChange={e => change("status", e.target.value)} className={cn(field, "w-auto shrink-0")} aria-label={t("activity.status")}>
          <option value="">{t("activity.allStatuses")}</option>
          {(["pending", "returned", "failed", "unknown"] as const).map(status => <option key={status} value={status}>{t(`activity.statuses.${status}`)}</option>)}
        </select>
        <button
          type="button"
          onClick={() => setFiltersOpen(value => !value)}
          aria-expanded={filtersOpen}
          className={cn(button, "shrink-0")}
        >
          <Settings2 className="h-3.5 w-3.5" />
          {filtersOpen ? t("activity.hideFilters") : t("activity.moreFilters")}
          {activeFilterCount > 0 && (
            <span className="ml-0.5 rounded-full bg-accent-bg px-1.5 text-[11px] font-medium tabular-nums text-accent-dark dark:text-accent-light">
              {activeFilterCount}
            </span>
          )}
        </button>
        {activeFilterCount > 0 && (
          <button
            type="button"
            className={cn(button, "shrink-0")}
            onClick={() => { setFilters(initialFilters); setLoading(true); setQuery({ page: 1, pageSize }); }}
          >
            {t("activity.reset")}
          </button>
        )}
        <button className="inline-flex h-[38px] shrink-0 items-center gap-2 rounded-lg border border-accent-border bg-accent-dark px-3.5 text-[13px] font-medium text-white outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-accent">
          <Search className="h-4 w-4" />{t("activity.apply")}
        </button>
      </div>

      {filtersOpen && (
        <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
          <label className="grid gap-1 text-[12px] text-secondary">{t("activity.project")}<input value={filters.project} onChange={e => change("project", e.target.value)} className={field} placeholder={t("activity.projectSearch")} /></label>
          <label className="grid gap-1 text-[12px] text-secondary">{t("activity.from")}<input type="date" value={filters.from} onChange={e => change("from", e.target.value)} className={field} /></label>
          <label className="grid gap-1 text-[12px] text-secondary">{t("activity.to")}<input type="date" value={filters.to} onChange={e => change("to", e.target.value)} className={field} /></label>
        </div>
      )}
    </form>

    {/* 主区：左列表 + 右详情 */}
    <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section aria-label={t("activity.records")} className="app-panel min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border-subtle px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label={t("activity.kind")}>
            {kindTabs.map(tab => (
              <button
                key={tab.key || "all"}
                type="button"
                role="tab"
                aria-selected={filters.kind === tab.key}
                onClick={() => pickKind(tab.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
                  filters.kind === tab.key ? "bg-surface-active font-medium text-secondary" : "text-muted hover:bg-surface-hover hover:text-secondary"
                )}
              >
                {tab.label}
                <span className="tabular-nums text-[11.5px] text-tertiary">{tab.count}</span>
              </button>
            ))}
          </div>
          <span aria-live="polite" className="text-[12px] tabular-nums text-tertiary">
            {(["manual", "automatic", "unknown"] as const).map(trigger => `${t(`activity.triggers.${trigger}`)} ${result?.counts[trigger] ?? 0}`).join(" · ")}
          </span>
        </div>

        <ActivityTable
          items={result?.items ?? []}
          selectedId={selected?.id ?? null}
          onSelect={selectRecord}
          loading={loading && !result}
          error={result ? undefined : error || undefined}
          emptyText={emptyText}
          onRetry={refresh}
        />

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle px-3 py-2.5 text-[12px] text-tertiary">
          <span aria-live="polite">{t("activity.total", { count: result?.total ?? 0 })}</span>
          <div className="flex items-center gap-2">
            <span>{t("activity.page", { current: result?.page ?? 1, pages })}</span>
            <button type="button" className={button} disabled={!result || result.page <= 1} onClick={() => setQuery(q => ({ ...q, page: (result?.page ?? 1) - 1 }))} aria-label={t("activity.previous")}><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" className={button} disabled={!result || result.page >= pages} onClick={() => setQuery(q => ({ ...q, page: (result?.page ?? 1) + 1 }))} aria-label={t("activity.next")}><ChevronRight className="h-4 w-4" /></button>
          </div>
        </footer>
      </section>

      {/* 并排时详情栏吸顶跟随：列表长也不用把详情滚回来 */}
      <aside ref={detailRef} className="app-panel min-w-0 self-start px-4 py-3.5 lg:sticky lg:top-4">
        <h2 className="border-b border-border-subtle pb-2.5 text-[13px] font-semibold text-secondary">{t("activity.recordDetail")}</h2>
        {selected
          ? <ActivityDetailPanel
            record={selected}
            className="pt-3"
            // 技能详情是全局弹层：只打开它、不换页，关掉就回到这条调用记录上
            onOpenSkill={openSkillDetailById}
          />
          : <p className="py-6 text-center text-[13px] text-tertiary">{t("activity.noSelection")}</p>}
      </aside>
    </div>
  </div>;
}
