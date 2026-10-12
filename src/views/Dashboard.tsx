import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layers, CheckCircle2, Bot, Plus, Download, AlertTriangle, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useApp } from "../context/AppContext";
import { AgentControlSetupCard } from "../components/AgentControlSetupCard";
import { AgentIcon } from "../components/AgentIcon";
import { getActivity, toolIconKeys, toolNames, type ActivityEvent } from "../lib/activity";
import { cn } from "../utils";
import type { ManagedSkill } from "../lib/tauri";

const FEED_LIMIT = 8;

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

  const enabledAgents = useMemo(
    () => tools.filter((tool) => tool.installed && tool.enabled),
    [tools]
  );

  const totalSkills = managedSkills.length;
  const syncedSkills = useMemo(
    () => managedSkills.filter((s) => s.targets.length > 0).length,
    [managedSkills]
  );

  const divergedCount = useMemo(
    () => projects.reduce((acc, p) => acc + p.sync_health.diverged, 0),
    [projects]
  );

  // 调用记录：与技能更新时间合并成一条按时间倒序的动态流。
  useEffect(() => {
    let current = true;
    getActivity({ page: 1, pageSize: FEED_LIMIT })
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
    return entries.sort((a, b) => b.timestamp - a.timestamp).slice(0, FEED_LIMIT);
  }, [activity, managedSkills]);

  const coverageLabel = totalSkills === 0 ? "0" : `${syncedSkills}/${totalSkills}`;
  const syncCardIcon = divergedCount > 0 ? AlertTriangle : CheckCircle2;
  const syncCardColor = divergedCount > 0 ? "text-amber-400" : "text-emerald-400";
  const syncCardBg = divergedCount > 0 ? "bg-amber-500/[0.08]" : "bg-emerald-500/[0.08]";

  const formatTime = (value: number) => value
    ? new Date(value).toLocaleString(i18n.language, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : t("activity.unknownTime");

  function openEntry(entry: FeedEntry) {
    if (entry.type === "skill") { openSkillDetailById(entry.skill.id); navigate("/my-skills"); return; }
    if (entry.record.managedSkillId) { openSkillDetailById(entry.record.managedSkillId); navigate("/my-skills"); return; }
    navigate(`/skill-activity?skill=${encodeURIComponent(entry.record.skillName)}`);
  }

  return (
    <div className="app-page app-page-narrow">
      <div className="app-page-header">
        <h1 className="app-page-title">{t("dashboard.greeting")}</h1>
        <p className="app-page-subtitle text-tertiary">
          {t("dashboard.summary", {
            skills: totalSkills,
            agents: enabledAgents.length,
            projects: projects.length,
          })}
        </p>
      </div>

      <AgentControlSetupCard />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3.5">
        {[
          {
            title: t("dashboard.librarySkills"),
            value: String(totalSkills),
            icon: Layers,
            color: "text-accent-light",
            bg: "bg-accent-bg",
          },
          {
            title: t("dashboard.syncCoverage"),
            value: coverageLabel,
            icon: syncCardIcon,
            color: syncCardColor,
            bg: syncCardBg,
          },
          {
            title: t("dashboard.connectedAgents"),
            value: String(enabledAgents.length),
            icon: Bot,
            color: "text-sky-400",
            bg: "bg-sky-500/[0.08]",
          },
        ].map((stat, i) => {
          const Icon = stat.icon;
          return (
            <div
              key={i}
              className="app-panel flex items-center justify-between px-4 py-4 transition-colors hover:border-border"
            >
              <div>
                <p className="app-section-title mb-1">
                  {stat.title}
                </p>
                <h3 className="text-xl font-semibold text-primary leading-none">{stat.value}</h3>
              </div>
              <div className={`p-2 rounded-md ${stat.bg} ${stat.color} border border-border-subtle`}>
                <Icon className="w-4 h-4" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={() => navigate("/install?tab=local")}
          className="app-button-primary flex-1"
        >
          <Download className="w-4 h-4" />
          {t("dashboard.scanImport")}
        </button>
        <button
          onClick={() => navigate("/install")}
          className="app-button-secondary flex-1"
        >
          <Plus className="w-4 h-4 text-tertiary" />
          {t("dashboard.installNew")}
        </button>
      </div>

      {/* Recent activity：技能更新 + Skill 调用记录合并的时间线 */}
      <div>
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <h2 className="app-section-title">{t("dashboard.recentActivity")}</h2>
          <button
            type="button"
            onClick={() => navigate("/skill-activity")}
            className="inline-flex items-center gap-1 rounded-md text-[12px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
          >
            {t("dashboard.recentActivityViewAll")}
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>

        {feed.length === 0 ? (
          <div className="app-panel px-4 py-6 text-center text-[13px] text-muted">
            {activityError ? t("dashboard.recentActivityError") : t("dashboard.recentActivityEmpty")}
          </div>
        ) : (
          <div className="app-panel overflow-hidden divide-y divide-border-subtle">
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
                  className="flex cursor-pointer items-center justify-between gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface-hover"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    {entry.type === "activity" ? (
                      <AgentIcon
                        agentKey={toolIconKeys[entry.record.tool] ?? entry.record.tool}
                        displayName={toolNames[entry.record.tool]}
                        className="h-6 w-6"
                      />
                    ) : (
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] bg-accent-bg text-[13px] font-semibold text-accent-light">
                        {skillName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <h4 className="flex min-w-0 flex-wrap items-center gap-1.5 text-[13px] font-medium text-secondary">
                        <span className="max-w-[220px] truncate" title={skillName}>{skillName}</span>
                        {entry.type === "activity" ? (
                          <>
                            <span className="rounded border border-border-subtle bg-surface-hover px-1.5 py-px text-[9px] font-normal text-muted">
                              {toolNames[entry.record.tool]}
                            </span>
                            <span className={cn("rounded border px-1.5 py-px text-[9px] font-normal", TRIGGER_TONE[entry.record.trigger])}>
                              {t(`activity.triggers.${entry.record.trigger}`)}
                            </span>
                            {entry.record.status === "failed" && (
                              <span className="text-[9px] font-normal text-danger">{t("activity.statuses.failed")}</span>
                            )}
                          </>
                        ) : (
                          <span className="rounded border border-border font-normal px-1.5 py-px text-[9px] text-muted bg-surface-hover">
                            {entry.skill.source_type}
                          </span>
                        )}
                      </h4>
                      <p className="mt-px truncate text-[13px] text-muted" title={entry.type === "activity" ? entry.record.project ?? undefined : undefined}>
                        {entry.type === "activity"
                          ? `${entry.record.project || t("activity.noProject")} · ${t(`activity.kinds.${entry.record.kind}`)}`
                          : entry.skill.targets.length > 0
                            ? `${t("dashboard.synced")} → ${entry.skill.targets.map((target) => target.tool).join(", ")}`
                            : t("dashboard.notSynced")}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-[12px] tabular-nums text-muted">{formatTime(entry.timestamp)}</span>
                </div>
              );
            })}
          </div>
        )}

        {activityError && feed.length > 0 && (
          <p className="mt-2 text-[12px] text-amber-500">{t("dashboard.recentActivityError")}</p>
        )}
      </div>
    </div>
  );
}
