import { Fragment, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { History, RefreshCw, Square, ChevronLeft, ChevronRight, ChevronDown, Search, Settings2 } from "lucide-react";
import { useApp } from "../context/AppContext";
import { listen } from "../lib/transport";
import { cn } from "../utils";
import * as api from "../lib/activity";

const field = "min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent";
const button = "inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-secondary hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40";
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
    catch (error) { setError(String(error instanceof Error ? error.message : error)); }
    finally { setSaving(false); }
  }
  return <form onSubmit={save} className="border-t border-border-subtle py-3 first:border-t-0">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
      <label htmlFor={id} className="font-medium text-primary">{api.toolNames[source.tool]}</label>
      <span className={cn("text-xs", ["partial", "missing", "denied", "error"].includes(source.state) ? "text-amber-500" : "text-tertiary")}>
        {t(`activity.sourceStates.${source.state}`, { defaultValue: source.state })}
        {source.state === "scanning" && ` · ${source.processed}/${source.files}`}
        {source.errors > 0 && ` · ${t("activity.issues", { count: source.errors })}`}
      </span>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <input id={id} value={path} onChange={event => setPath(event.target.value)} disabled={running || saving}
        className={cn(field, "flex-1 basis-64 font-mono text-xs")} required />
      <label className="flex items-center gap-2 text-sm text-secondary"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} disabled={running || saving} />{t("activity.enabled")}</label>
      <button className={button} disabled={running || saving}>{t(saving ? "activity.saving" : "activity.save")}</button>
    </div>
    <p className="mt-2 text-xs text-tertiary">{t("activity.lastScan")}: {source.lastScan ? new Date(source.lastScan).toLocaleString(i18n.language) : t("activity.never")}</p>
    {source.detail && <p className="mt-1 text-xs text-amber-500">{source.detail}</p>}
    {error && <p role="alert" className="mt-1 text-xs text-red-500">{error}</p>}
  </form>;
}

export function SkillActivity() {
  const { t, i18n } = useTranslation();
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
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => setRevision(value => value + 1);

  useEffect(() => {
    let current = true;
    Promise.all([api.getActivity(query), api.getActivitySources()]).then(([data, status]) => {
      if (!current) return;
      setResult(data); setSources(status.sources); setRunning(status.running); setError(""); setLoading(false);
    }).catch(error => { if (current) { setError(String(error instanceof Error ? error.message : error)); setLoading(false); } });
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
    catch (error) { setError(String(error instanceof Error ? error.message : error)); }
    finally { setBusy(false); }
  }
  function apply(event: FormEvent) {
    event.preventDefault();
    const from = filters.from ? new Date(`${filters.from}T00:00:00`).getTime() : undefined;
    const end = filters.to ? new Date(`${filters.to}T00:00:00`) : null;
    if (end) end.setDate(end.getDate() + 1);
    const to = end?.getTime();
    if (from !== undefined && to !== undefined && from >= to) { setError(t("activity.invalidDates")); return; }
    setLoading(true); setExpanded(null);
    setQuery({ page: 1, pageSize: 50, tool: filters.tool as api.ActivityQuery["tool"], kind: filters.kind as api.ActivityQuery["kind"],
      trigger: filters.trigger as api.ActivityQuery["trigger"], skillName: filters.skillName.trim(), project: filters.project.trim(), from, to });
  }
  const change = (key: keyof typeof filters, value: string) => setFilters(current => ({ ...current, [key]: value }));
  const date = (value: number | null) => value === null ? t("activity.unknownTime") : new Date(value).toLocaleString(i18n.language);
  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const problems = sources.filter(source => source.enabled && ["partial", "missing", "denied", "error"].includes(source.state));

  return <div className="app-page space-y-4">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="app-page-title flex items-center gap-2"><History className="h-6 w-6 text-accent-light" />{t("activity.title")}</h1>
        <p className="mt-1 text-sm text-tertiary">{t("activity.subtitle")}</p></div>
      <button type="button" onClick={() => void scan()} disabled={busy} className={button}>
        {running ? <Square className="h-4 w-4" /> : <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />}
        {t(running ? "activity.stop" : "activity.refresh")}
      </button>
    </header>

    {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-500"><span>{error}</span><button className={button} onClick={refresh}>{t("activity.retry")}</button></div>}
    <div className="grid grid-cols-3 gap-3" aria-label={t("activity.summary")}>
      {(["invocation", "document", "request"] as const).map(kind => <div key={kind} className="rounded-xl border border-border-subtle bg-surface px-4 py-3">
        <div className="text-xs text-tertiary">{t(`activity.kinds.${kind}`)}</div><div className="mt-1 text-2xl font-semibold tabular-nums text-primary">{result?.counts[kind] ?? "—"}</div>
      </div>)}
    </div>
    <p className="text-xs text-tertiary">{t("activity.countNote")}</p>

    <form onSubmit={apply} className="grid grid-cols-2 gap-3 rounded-xl border border-border-subtle bg-surface p-4 xl:grid-cols-4">
      <label className="grid gap-1 text-xs text-secondary">{t("activity.skill")}<input value={filters.skillName} onChange={e => change("skillName", e.target.value)} className={field} placeholder={t("activity.skillSearch")} /></label>
      <label className="grid gap-1 text-xs text-secondary">{t("activity.project")}<input value={filters.project} onChange={e => change("project", e.target.value)} className={field} placeholder={t("activity.projectSearch")} /></label>
      <label className="grid gap-1 text-xs text-secondary">{t("activity.tool")}<select value={filters.tool} onChange={e => change("tool", e.target.value)} className={field}><option value="">{t("activity.allTools")}</option>{api.activityTools.map(tool => <option key={tool} value={tool}>{api.toolNames[tool]}</option>)}</select></label>
      <label className="grid gap-1 text-xs text-secondary">{t("activity.trigger")}<select value={filters.trigger} onChange={e => change("trigger", e.target.value)} className={field}><option value="">{t("activity.allTriggers")}</option>{(["manual", "automatic", "unknown"] as const).map(trigger => <option key={trigger} value={trigger}>{t(`activity.triggers.${trigger}`)}</option>)}</select></label>
      <label className="grid gap-1 text-xs text-secondary">{t("activity.from")}<input type="date" value={filters.from} onChange={e => change("from", e.target.value)} className={field} /></label>
      <label className="grid gap-1 text-xs text-secondary">{t("activity.to")}<input type="date" value={filters.to} onChange={e => change("to", e.target.value)} className={field} /></label>
      <label className="grid gap-1 text-xs text-secondary">{t("activity.kind")}<select value={filters.kind} onChange={e => change("kind", e.target.value)} className={field}><option value="">{t("activity.allKinds")}</option>{(["invocation", "document", "request"] as const).map(kind => <option key={kind} value={kind}>{t(`activity.kinds.${kind}`)}</option>)}</select></label>
      <div className="flex items-end gap-2"><button className={cn(button, "border-accent/30 text-accent-light")}><Search className="h-4 w-4" />{t("activity.apply")}</button><button type="button" className={button} onClick={() => { setFilters(initialFilters); setQuery({ page: 1, pageSize: 50 }); setExpanded(null); }}>{t("activity.reset")}</button></div>
    </form>

    <details className="rounded-xl border border-border-subtle bg-surface p-4">
      <summary className="cursor-pointer text-sm font-medium text-secondary"><Settings2 className="mr-2 inline h-4 w-4" />{t("activity.sources")}
        <span aria-live="polite" className="ml-2 text-xs font-normal text-tertiary">{running ? t("activity.scanning") : t("activity.sourceSummary", { count: sources.filter(source => source.enabled).length })}{problems.length > 0 && ` · ${t("activity.sourceProblems", { count: problems.length })}`}</span>
      </summary>
      <p className="my-3 text-xs leading-relaxed text-tertiary">{t("activity.sourceHelp")}</p>
      {sources.map(source => <SourceEditor key={`${source.tool}:${source.path}:${source.enabled}`} source={source} running={running} onSaved={refresh} />)}
    </details>

    <section className="overflow-hidden rounded-xl border border-border-subtle bg-surface" aria-label={t("activity.records")}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-4 py-3 text-xs text-tertiary">
        <span aria-live="polite">{t("activity.total", { count: result?.total ?? 0 })}</span>
        <span>{(["manual", "automatic", "unknown"] as const).map(trigger => `${t(`activity.triggers.${trigger}`)} ${result?.counts[trigger] ?? 0}`).join(" · ")}</span>
      </div>
      {loading && !result ? <p role="status" className="p-10 text-center text-sm text-tertiary">{t("activity.loading")}</p> : !result?.items.length ?
        <div className="px-6 py-12 text-center"><History className="mx-auto mb-3 h-7 w-7 text-muted" /><p className="text-sm text-primary">{t(error ? "activity.unavailable" : running ? "activity.scanning" : "activity.empty")}</p><p className="mt-2 text-xs text-tertiary">{t(problems.length ? "activity.checkSources" : "activity.emptyHint")}</p></div> :
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-background/50 text-xs text-tertiary"><tr>{["time", "skill", "tool", "kind", "trigger", "status", "details"].map(key => <th key={key} scope="col" className="whitespace-nowrap px-4 py-3 font-medium">{t(`activity.${key}`)}</th>)}</tr></thead>
          <tbody>{result.items.map(record => <Fragment key={record.id}>
            <tr className="border-t border-border-subtle hover:bg-surface-hover/50">
              <td className="whitespace-nowrap px-4 py-3 text-xs text-tertiary">{date(record.timestamp)}</td>
              <td className="max-w-[260px] px-4 py-3"><span className="block truncate font-medium text-primary" title={record.skillName}>{record.skillName}</span><span className="mt-1 block truncate text-xs text-tertiary" title={record.project || ""}>{record.project || t("activity.noProject")}</span></td>
              <td className="px-4 py-3 text-secondary">{api.toolNames[record.tool]}</td>
              <td className="whitespace-nowrap px-4 py-3 text-xs text-secondary">{t(`activity.kinds.${record.kind}`)}</td>
              <td className="whitespace-nowrap px-4 py-3 text-xs"><span className={cn("rounded-md px-2 py-1", record.trigger === "manual" ? "bg-blue-500/10 text-blue-500" : record.trigger === "automatic" ? "bg-accent-bg text-accent-light" : "bg-surface-hover text-tertiary")}>{t(`activity.triggers.${record.trigger}`)}</span></td>
              <td className={cn("whitespace-nowrap px-4 py-3 text-xs", record.status === "failed" ? "text-red-500" : "text-tertiary")}>{t(`activity.statuses.${record.status}`)}</td>
              <td className="px-4 py-3"><button type="button" className="rounded p-1 text-secondary focus-visible:outline focus-visible:outline-accent" onClick={() => setExpanded(expanded === record.id ? null : record.id)} aria-expanded={expanded === record.id} aria-controls={`event-${record.id}`} aria-label={t("activity.eventDetails", { skill: record.skillName })}><ChevronDown className={cn("h-4 w-4 transition-transform", expanded === record.id && "rotate-180")} /></button></td>
            </tr>
            {expanded === record.id && <tr id={`event-${record.id}`} className="border-t border-border-subtle bg-background/50"><td colSpan={7} className="px-5 py-4">
              <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-xs">
                {[["evidence", t(`activity.evidenceCodes.${record.evidence}`, { defaultValue: record.evidence })], ["sourceFile", record.sourcePath], ["position", record.sourceLine], ["session", record.sessionId], ["call", record.callId], ["project", record.project], ["skillPath", record.skillPath]].map(([key, value]) => <Fragment key={key}><dt className="text-tertiary">{t(`activity.${key}`)}</dt><dd className="min-w-0 break-all text-secondary">{value || "—"}</dd></Fragment>)}
              </dl>
              <p className="mt-3 text-xs text-tertiary">{t("activity.statusNote")}</p>
              {record.managedSkillId ? <button type="button" className={cn(button, "mt-3")} onClick={() => { openSkillDetailById(record.managedSkillId!); navigate("/my-skills"); }}>{t("activity.openSkill")}</button> : <p className="mt-3 text-xs text-tertiary">{t("activity.unlinked")}</p>}
            </td></tr>}
          </Fragment>)}</tbody></table></div>}
      <footer className="flex items-center justify-between border-t border-border-subtle px-4 py-3 text-xs text-tertiary">
        <span>{t("activity.page", { current: result?.page ?? 1, pages })}</span><div className="flex gap-2">
          <button type="button" className={button} disabled={!result || result.page <= 1} onClick={() => { setQuery(q => ({ ...q, page: (result?.page ?? 1) - 1 })); setExpanded(null); }} aria-label={t("activity.previous")}><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" className={button} disabled={!result || result.page >= pages} onClick={() => { setQuery(q => ({ ...q, page: (result?.page ?? 1) + 1 })); setExpanded(null); }} aria-label={t("activity.next")}><ChevronRight className="h-4 w-4" /></button>
        </div>
      </footer>
    </section>
  </div>;
}
