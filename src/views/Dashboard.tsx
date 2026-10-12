import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layers, Plus, Download, AlertTriangle, ArrowRight, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useApp } from "../context/AppContext";
import { AgentControlSetupCard } from "../components/AgentControlSetupCard";
import { AgentIcon } from "../components/AgentIcon";
import { getActivity, toolNames, type ActivityEvent } from "../lib/activity";
import { cn } from "../utils";
import type { ManagedSkill } from "../lib/tauri";

const FEED_LIMIT = 7;
const AGENT_ICON_LIMIT = 6;

type FeedEntry =
  | { type: "activity"; key: string; timestamp: number; record: ActivityEvent }
  | { type: "skill"; key: string; timestamp: number; skill: ManagedSkill };

const TRIGGER_TONE: Record<ActivityEvent["trigger"], string> = {
  manual: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300",
  automatic: "border-accent-border bg-accent-bg text-accent-dark dark:text-accent-light",
  unknown: "border-border-subtle bg-surface-hover text-tertiary",
};

export function Dashboard() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { tools, projects, managedSkills, openSkillDetailById } = useApp();
  const [activity, setActivity] = useState<ActivityEvent[] | null>(null);
  const [activityError, setActivityError] = useState("");
  const [feedTab, setFeedTab] = useState<"all" | "activity" | "skills">("all");

  const enabledAgents = useMemo(
    () => tools.filter((tool) => tool.installed && tool.enabled),
    [tools]
  );

  const totalSkills = managedSkills.length;
  const syncedSkills = useMemo(
    () => managedSkills.filter((s) => s.targets.length > 0).length,
    [managedSkills]
  );
  const pendingSkills = Math.max(0, totalSkills - syncedSkills);
  const coveragePercent = totalSkills === 0 ? 0 : Math.round((syncedSkills / totalSkills) * 1000) / 10;

  // 各 Agent 的已部署技能数：按"该技能至少有一个部署目标是这个 Agent"计数。
  const agentRows = useMemo(
    () => enabledAgents
      .map((tool) => ({
        tool,
        count: managedSkills.filter((skill) => skill.targets.some((target) => target.tool === tool.key)).length,
      }))
      .sort((a, b) => b.count - a.count || a.tool.display_name.localeCompare(b.tool.display_name)),
    [enabledAgents, managedSkills]
  );

  const divergedProjects = useMemo(
    () => projects.filter((project) => project.sync_health.diverged > 0),
    [projects]
  );
  const divergedCount = divergedProjects.reduce((acc, project) => acc + project.sync_health.diverged, 0);

  // 调用记录：与技能更新时间合并成一条按时间倒序的动态流。
  useEffect(() => {
    let current = true;
    getActivity({ page: 1, pageSize: FEED_LIMIT * 2 })
      .then(result => { if (current) { setActivity(result.items); setActivityError(""); } })
      .catch(error => { if (current) { setActivity(null); setActivityError(String(error instanceof Error ? error.message : error)); } });
    return () => { current = false; };
  }, [managedSkills]);

  const feed = useMemo(() => {
    const entries: FeedEntry[] = [];
    for (const record of activity ?? []) {
      entries.push({ type: "activity", key: `a:${record.id}`, timestamp: record.timestamp ?? 0, record });
    }
    for (const skill of managedSkills) {
      entries.push({ type: "skill", key: `s:${skill.id}`, timestamp: skill.updated_at ?? 0, skill });
    }
    return entries
      .filter(entry => feedTab === "all" || (feedTab === "activity" ? entry.type === "activity" : entry.type === "skill"))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, FEED_LIMIT);
  }, [activity, managedSkills, feedTab]);

  const formatTime = (value: number) => value
    ? new Date(value).toLocaleString(i18n.language, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : t("activity.unknownTime");

  function openEntry(entry: FeedEntry) {
    if (entry.type === "skill") { openSkillDetailById(entry.skill.id); navigate("/my-skills"); return; }
    if (entry.record.managedSkillId) { openSkillDetailById(entry.record.managedSkillId); navigate("/my-skills"); return; }
    navigate(`/skill-activity?skill=${encodeURIComponent(entry.record.skillName)}`);
  }

  const feedTabs = [
    { key: "all" as const, label: t("dashboard.feedTabAll") },
    { key: "activity" as const, label: t("dashboard.feedTabActivity") },
    { key: "skills" as const, label: t("dashboard.feedTabUpdates") },
  ];

  return (
    <div className="app-page">
      {/* 页头：位置 + 两个主要入口 */}
      <header className="app-page-header flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] text-muted">{t("dashboard.breadcrumb")}</p>
          <h1 className="app-page-title mt-0.5">{t("dashboard.title")}</h1>
          <p className="app-page-subtitle">
            {t("dashboard.summary", {
              skills: totalSkills,
              agents: enabledAgents.length,
              projects: projects.length,
            })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => navigate("/install?tab=local")} className="app-button-secondary h-10">
            <Download className="h-4 w-4 text-tertiary" />
            {t("dashboard.scanImport")}
          </button>
          <button type="button" onClick={() => navigate("/install")} className="app-button-primary h-10">
            <Plus className="h-4 w-4" />
            {t("dashboard.installNew")}
          </button>
        </div>
      </header>

      {/* 三项统计 */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        {/* 技能总量 */}
        <section className="app-panel flex items-start justify-between gap-3 px-4 py-3.5">
          <div className="min-w-0">
            <p className="app-section-title">{t("dashboard.librarySkills")}</p>
            <h3 className="mt-1 text-[30px] font-semibold leading-9 tabular-nums text-primary">{totalSkills}</h3>
            <button
              type="button"
              onClick={() => navigate("/my-skills")}
              className="mt-2 inline-flex items-center gap-1 rounded text-[12px] font-medium text-accent-dark outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent dark:text-accent-light"
            >
              {t("dashboard.libraryLink")}
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <Layers className="h-9 w-9 shrink-0 text-accent-light/25" />
        </section>

        {/* 部署覆盖 */}
        <section className="app-panel px-4 py-3.5">
          <p className="app-section-title">{t("dashboard.syncCoverage")}</p>
          <h3 className="mt-1 text-[30px] font-semibold leading-9 tabular-nums text-primary">
            {syncedSkills}
            <span className="text-[18px] font-normal text-muted"> / {totalSkills}</span>
          </h3>
          <div className="mt-2.5 flex items-center gap-2">
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-active">
              <div className="h-full rounded-full bg-accent-light" style={{ width: `${coveragePercent}%` }} />
            </div>
            <span className="shrink-0 text-[12px] tabular-nums text-tertiary">{coveragePercent}%</span>
          </div>
          <p className="mt-2 text-[12px] text-tertiary">{t("dashboard.pendingDeploy", { count: pendingSkills })}</p>
        </section>

        {/* 已启用 Agent */}
        <section className="app-panel flex items-start justify-between gap-3 px-4 py-3.5">
          <div className="min-w-0">
            <p className="app-section-title">{t("dashboard.connectedAgents")}</p>
            <h3 className="mt-1 text-[30px] font-semibold leading-9 tabular-nums text-primary">{enabledAgents.length}</h3>
            <button
              type="button"
              onClick={() => navigate("/global-workspace")}
              className="mt-2 inline-flex items-center gap-1 rounded text-[12px] font-medium text-accent-dark outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent dark:text-accent-light"
            >
              {t("dashboard.workspaceLink")}
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1 pt-0.5">
            {agentRows.slice(0, AGENT_ICON_LIMIT).map(({ tool }) => (
              <AgentIcon
                key={tool.key}
                agentKey={tool.key}
                displayName={tool.display_name}
                className="h-6 w-6 rounded-md border border-border-subtle"
              />
            ))}
            {agentRows.length > AGENT_ICON_LIMIT && (
              <span className="text-[12px] tabular-nums text-tertiary">+{agentRows.length - AGENT_ICON_LIMIT}</span>
            )}
          </div>
        </section>
      </div>

      {/* 双栏：左动态，右部署概况与同步提醒 */}
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="app-panel min-w-0 overflow-hidden">
          <div className="border-b border-border-subtle px-3.5 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[13px] font-semibold text-secondary">{t("dashboard.recentActivity")}</h2>
              <button
                type="button"
                onClick={() => navigate("/skill-activity")}
                className="inline-flex items-center gap-1 rounded-md text-[12px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
              >
                {t("dashboard.recentActivityViewAll")}
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1" role="tablist" aria-label={t("dashboard.recentActivity")}>
              {feedTabs.map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={feedTab === tab.key}
                  onClick={() => setFeedTab(tab.key)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[12.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
                    feedTab === tab.key ? "bg-surface-active font-medium text-secondary" : "text-muted hover:bg-surface-hover hover:text-secondary"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {feed.length === 0 ? (
            <p className="px-3.5 py-8 text-center text-[13px] text-muted">
              {activityError ? t("dashboard.recentActivityError") : t("dashboard.recentActivityEmpty")}
            </p>
          ) : (
            <div className="divide-y divide-border-subtle">
              {feed.map((entry) => {
                const skillName = entry.type === "activity" ? entry.record.skillName : entry.skill.name;
                return (
                  <div
                    key={entry.key}
                    role="button"
                    tabIndex={0}
                    onClick={() => openEntry(entry)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openEntry(entry); }
                    }}
                    className="flex cursor-pointer items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface-hover"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-accent-bg text-[12px] font-semibold uppercase text-accent-dark dark:text-accent-light">
                      {skillName.charAt(0)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="max-w-[200px] truncate text-[13px] font-medium text-accent-dark dark:text-accent-light" title={skillName}>{skillName}</span>
                        {entry.type === "activity" ? (
                          <>
                            <span className="rounded border border-border-subtle bg-surface-hover px-1.5 py-px text-[10px] leading-4 text-tertiary">
                              {toolNames[entry.record.tool]}
                            </span>
                            <span className={cn("rounded border px-1.5 py-px text-[10px] leading-4", TRIGGER_TONE[entry.record.trigger])}>
                              {t(`activity.triggers.${entry.record.trigger}`)}
                            </span>
                            {entry.record.status === "failed" && (
                              <span className="rounded border border-red-500/30 bg-red-500/10 px-1.5 py-px text-[10px] leading-4 text-red-600 dark:text-red-300">
                                {t("activity.statuses.failed")}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="rounded border border-border-subtle bg-surface-hover px-1.5 py-px text-[10px] leading-4 text-tertiary">
                            {entry.skill.source_type}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-[12px] leading-4 text-tertiary" title={entry.type === "activity" ? entry.record.project ?? undefined : undefined}>
                        {entry.type === "activity"
                          ? `${entry.record.project || t("activity.noProject")} · ${t(`activity.kinds.${entry.record.kind}`)}`
                          : entry.skill.targets.length > 0
                            ? `${t("dashboard.synced")} → ${entry.skill.targets.map((target) => target.tool).join(", ")}`
                            : t("dashboard.notSynced")}
                      </p>
                    </div>
                    <span className="shrink-0 whitespace-nowrap text-[12px] tabular-nums text-tertiary">{formatTime(entry.timestamp)}</span>
                  </div>
                );
              })}
            </div>
          )}

          {activityError && feed.length > 0 && (
            <p className="border-t border-border-subtle px-3.5 py-2 text-[12px] text-amber-600 dark:text-amber-400">{t("dashboard.recentActivityError")}</p>
          )}
        </section>

        <div className="min-w-0 space-y-4">
          {/* Agent 部署 */}
          <section className="app-panel overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-3.5 py-2.5">
              <h2 className="text-[13px] font-semibold text-secondary">{t("dashboard.deployOverview")}</h2>
              <span className="text-[11.5px] text-tertiary">{t("dashboard.deployedSkills")}</span>
            </div>
            {agentRows.length === 0 ? (
              <p className="px-3.5 py-6 text-center text-[12.5px] text-tertiary">{t("dashboard.noEnabledAgents")}</p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {agentRows.map(({ tool, count }) => (
                  <li key={tool.key}>
                    <button
                      type="button"
                      onClick={() => navigate(`/global-workspace/${tool.key}`)}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <AgentIcon agentKey={tool.key} displayName={tool.display_name} className="h-5 w-5 shrink-0 rounded" />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-secondary">{tool.display_name}</span>
                      <span className="shrink-0 text-[13px] font-medium tabular-nums text-primary">{count}</span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-between gap-2 border-t border-border-subtle px-3.5 py-2">
              <span className="text-[11.5px] text-tertiary">{t("dashboard.agentScopeNote")}</span>
              <button
                type="button"
                onClick={() => navigate("/global-workspace")}
                className="inline-flex items-center gap-1 rounded text-[12px] font-medium text-accent-dark outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent dark:text-accent-light"
              >
                {t("dashboard.manageWorkspace")}
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </section>

          {/* 同步提醒：只在存在差异时出现，只提供查看入口 */}
          {divergedCount > 0 && (
            <section className="rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-3.5 py-3">
              <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4" />{t("dashboard.syncAlert")}
              </h2>
              <p className="mt-1.5 text-[13px] font-medium text-secondary">{t("dashboard.syncAlertCount", { count: divergedCount })}</p>
              <p className="mt-0.5 text-[12px] leading-5 text-tertiary">{t("dashboard.syncAlertBody")}</p>
              <button
                type="button"
                onClick={() => navigate(`/project/${divergedProjects[0].id}`)}
                className="mt-2 inline-flex items-center gap-1 rounded text-[12px] font-medium text-amber-700 outline-none hover:text-amber-600 focus-visible:ring-2 focus-visible:ring-accent dark:text-amber-300"
              >
                {t("dashboard.syncAlertAction")}
                <ArrowRight className="h-3 w-3" />
              </button>
            </section>
          )}
        </div>
      </div>

      <AgentControlSetupCard />
    </div>
  );
}
