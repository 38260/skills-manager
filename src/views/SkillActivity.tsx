import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { History, RefreshCw, Square, ChevronLeft, ChevronRight, Search, Settings2 } from "lucide-react";
import { useApp } from "../context/AppContext";
import { listen } from "../lib/transport";
import { cn } from "../utils";
import * as api from "../lib/activity";
import { ActivityRecordList } from "../components/ActivityRecordList";

const field = "min-w-0 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-[13px] text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent";
const button = "inline-flex items-center justify-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-[13px] text-secondary outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40";
const initialFilters = { tool: "", kind: "", trigger: "", skillName: "", project: "", from: "", to: "" };

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
      <span className={cn("text-[12px]", ["partial", "missing", "denied", "error"].includes(source.state) ? "text-amber-500" : "text-tertiary")}>
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
    {source.detail && <p className="mt-1 text-[12px] text-amber-500">{source.detail}</p>}
    {error && <p role="alert" className="mt-1 text-[12px] text-danger">{error}</p>}
  </form>;
}

export function SkillActivity() {
  const { t } = useTranslation();
  const { openSkillDetailById } = useApp();
  const navigate = useNavigate();
  // 详情页"调用记录"页签通过 /skill-activity?skill=名称 深链进入并预填筛选。
  const [searchParams] = useSearchParams();
  const deepLinkSkill = searchParams.get("skill") ?? "";
  const [filters, setFilters] = useState({ ...initialFilters, skillName: deepLinkSkill });
  const [query, setQuery] = useState<api.ActivityQuery>({ page: 1, pageSize: 50, skillName: deepLinkSkill });
  const [result, setResult] = useState<api.ActivityResult | null>(null);
  const [sources, setSources] = useState<api.ActivitySource[]>([]);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const refresh = () => setRevision(value => value + 1);

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
    void listen("skill-activity-changed", () => setRevision(value => value + 1)).then(stop => {
      if (disposed) stop(); else unlisten = stop;
    }).catch(() => { /* 定时刷新可覆盖通知连接中断。 */ });
    const timer = setInterval(() => setRevision(value => value + 1), 5000);
    return () => { disposed = true; unlisten?.(); clearInterval(timer); };
  }, []);

  async function scan() {
    setBusy(true);
    try { const status = running ? await api.cancelActivityScan() : await api.scanActivity(); setRunning(status.running); refresh(); }
    catch (cause) { setError(String(cause instanceof Error ? cause.message : cause)); }
    finally { setBusy(false); }
  }
  function apply(event: FormEvent) {
    event.preventDefault();
    const from = filters.from ? new Date(`${filters.from}T00:00:00`).getTime() : undefined;
    const end = filters.to ? new Date(`${filters.to}T00:00:00`) : null;
    if (end) end.setDate(end.getDate() + 1);
    const to = end?.getTime();
    if (from !== undefined && to !== undefined && from >= to) { setError(t("activity.invalidDates")); return; }
    setLoading(true);
    setQuery({ page: 1, pageSize: 50, tool: filters.tool as api.ActivityQuery["tool"], kind: filters.kind as api.ActivityQuery["kind"],
      trigger: filters.trigger as api.ActivityQuery["trigger"], skillName: filters.skillName.trim(), project: filters.project.trim(), from, to });
  }
  const change = (key: keyof typeof filters, value: string) => setFilters(current => ({ ...current, [key]: value }));
  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const problems = sources.filter(source => source.enabled && ["partial", "missing", "denied", "error"].includes(source.state));
  const stats = [
    { key: "invocation", label: t("activity.kinds.invocation"), value: result?.counts.invocation },
    { key: "document", label: t("activity.kinds.document"), value: result?.counts.document },
    { key: "request", label: t("activity.kinds.request"), value: result?.counts.request },
    { key: "total", label: t("activity.records"), value: result?.total },
  ];

  return <div className="app-page">
    {/* 页头：与详情页一致的扁平页头，操作右对齐 */}
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border-subtle pb-4">
      <div>
        <h1 className="app-page-title flex items-center gap-2"><History className="h-5 w-5 text-accent" />{t("activity.title")}</h1>
        <p className="mt-1.5 text-[13px] leading-5 text-muted">{t("activity.subtitle")}</p>
      </div>
      <button type="button" onClick={() => void scan()} disabled={busy} className={button}>
        {running ? <Square className="h-4 w-4" /> : <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />}
        {t(running ? "activity.stop" : "activity.refresh")}
      </button>
    </header>

    {error && <div role="alert" className="flex items-center justify-between gap-3 border-l-2 border-danger bg-danger-bg px-3 py-2 text-[13px] text-danger"><span>{error}</span><button className={button} onClick={refresh}>{t("activity.retry")}</button></div>}

    {/* 统计：平面数字行，用分隔线代替卡片 */}
    <div className="grid grid-cols-2 divide-x divide-border-subtle border-y border-border-subtle sm:grid-cols-4" aria-label={t("activity.summary")}>
      {stats.map(stat => <div key={stat.key} className="px-4 py-3 first:pl-0">
        <div className="text-[12px] text-tertiary">{stat.label}</div>
        <div className="mt-1 text-[22px] font-semibold tabular-nums leading-7 text-primary">{stat.value ?? "—"}</div>
      </div>)}
    </div>
    <p className="-mt-4 text-[12px] text-tertiary">{t("activity.countNote")}</p>

    {/* 筛选：扁平一行，去掉大圆角卡片 */}
    <form onSubmit={apply} className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-border-subtle pb-4 xl:grid-cols-4">
      <label className="grid gap-1 text-[12px] text-secondary">{t("activity.skill")}<input value={filters.skillName} onChange={e => change("skillName", e.target.value)} className={field} placeholder={t("activity.skillSearch")} /></label>
      <label className="grid gap-1 text-[12px] text-secondary">{t("activity.project")}<input value={filters.project} onChange={e => change("project", e.target.value)} className={field} placeholder={t("activity.projectSearch")} /></label>
      <label className="grid gap-1 text-[12px] text-secondary">{t("activity.tool")}<select value={filters.tool} onChange={e => change("tool", e.target.value)} className={field}><option value="">{t("activity.allTools")}</option>{api.activityTools.map(tool => <option key={tool} value={tool}>{api.toolNames[tool]}</option>)}</select></label>
      <label className="grid gap-1 text-[12px] text-secondary">{t("activity.trigger")}<select value={filters.trigger} onChange={e => change("trigger", e.target.value)} className={field}><option value="">{t("activity.allTriggers")}</option>{(["manual", "automatic", "unknown"] as const).map(trigger => <option key={trigger} value={trigger}>{t(`activity.triggers.${trigger}`)}</option>)}</select></label>
      <label className="grid gap-1 text-[12px] text-secondary">{t("activity.from")}<input type="date" value={filters.from} onChange={e => change("from", e.target.value)} className={field} /></label>
      <label className="grid gap-1 text-[12px] text-secondary">{t("activity.to")}<input type="date" value={filters.to} onChange={e => change("to", e.target.value)} className={field} /></label>
      <label className="grid gap-1 text-[12px] text-secondary">{t("activity.kind")}<select value={filters.kind} onChange={e => change("kind", e.target.value)} className={field}><option value="">{t("activity.allKinds")}</option>{(["invocation", "document", "request"] as const).map(kind => <option key={kind} value={kind}>{t(`activity.kinds.${kind}`)}</option>)}</select></label>
      <div className="flex items-end gap-2">
        <button className="inline-flex h-[38px] items-center gap-2 rounded-lg border border-accent-border bg-accent-bg px-3 text-[13px] font-medium text-accent-dark outline-none hover:bg-accent-bg focus-visible:ring-2 focus-visible:ring-accent dark:text-accent-light"><Search className="h-4 w-4" />{t("activity.apply")}</button>
        <button type="button" className={cn(button, "h-[38px]")} onClick={() => { setFilters(initialFilters); setQuery({ page: 1, pageSize: 50 }); }}>{t("activity.reset")}</button>
      </div>
    </form>

    <details className="border-b border-border-subtle pb-3">
      <summary className="cursor-pointer text-[13px] font-medium text-secondary"><Settings2 className="mr-2 inline h-4 w-4" />{t("activity.sources")}
        <span aria-live="polite" className="ml-2 text-[12px] font-normal text-tertiary">{running ? t("activity.scanning") : t("activity.sourceSummary", { count: sources.filter(source => source.enabled).length })}{problems.length > 0 && ` · ${t("activity.sourceProblems", { count: problems.length })}`}</span>
      </summary>
      <p className="my-3 text-[12px] leading-relaxed text-tertiary">{t("activity.sourceHelp")}</p>
      {sources.map(source => <SourceEditor key={`${source.tool}:${source.path}:${source.enabled}`} source={source} running={running} onSaved={refresh} />)}
    </details>

    <section aria-label={t("activity.records")}>
      <div className="flex flex-wrap items-center justify-between gap-2 py-2 text-[12px] text-tertiary">
        <span aria-live="polite">{t("activity.total", { count: result?.total ?? 0 })}</span>
        <span>{(["manual", "automatic", "unknown"] as const).map(trigger => `${t(`activity.triggers.${trigger}`)} ${result?.counts[trigger] ?? 0}`).join(" · ")}</span>
      </div>
      <ActivityRecordList
        items={result?.items ?? []}
        loading={loading && !result}
        error={result ? undefined : error || undefined}
        emptyText={t(problems.length ? "activity.checkSources" : "activity.empty")}
        onOpenSkill={id => { openSkillDetailById(id); navigate("/my-skills"); }}
        onRetry={refresh}
      />
      <footer className="flex items-center justify-between py-3 text-[12px] text-tertiary">
        <span>{t("activity.page", { current: result?.page ?? 1, pages })}</span>
        <div className="flex gap-2">
          <button type="button" className={button} disabled={!result || result.page <= 1} onClick={() => setQuery(q => ({ ...q, page: (result?.page ?? 1) - 1 }))} aria-label={t("activity.previous")}><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" className={button} disabled={!result || result.page >= pages} onClick={() => setQuery(q => ({ ...q, page: (result?.page ?? 1) + 1 }))} aria-label={t("activity.next")}><ChevronRight className="h-4 w-4" /></button>
        </div>
      </footer>
    </section>
  </div>;
}
