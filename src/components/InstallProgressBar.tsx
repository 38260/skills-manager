import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Check, DownloadCloud, Loader2, X } from "lucide-react";
import { useInstallTask } from "../context/InstallTaskContext";

/**
 * 侧边栏常驻的安装进度条。
 *
 * 进度状态由 InstallTaskContext 持有而不是安装页组件，因此离开安装页（切到技能库、
 * 仪表盘等）后进度条依然在更新，"安装过程不会被打断"。点击整块可回到安装页。
 */
export function InstallProgressBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { task, dismissTask, gitPreview, gitSelections, gitConfirmLoading } = useInstallTask();

  // 空闲态：如果克隆已完成、还有技能等待确认，给出返回入口，
  // 避免用户切走之后忘记这一步（后端预览目录还占着）。
  if (!task) {
    const pending = gitSelections.filter((item) => item.selected).length;
    if (!gitPreview || pending === 0 || gitConfirmLoading) return null;
    return (
      <div className="shrink-0 border-t border-border-subtle p-2.5">
        <button
          type="button"
          onClick={() => navigate("/install")}
          className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
        >
          <DownloadCloud className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium text-secondary">
              {t("install.progress.pending", { count: pending })}
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-muted">
              {t("install.progress.pendingHint")}
            </span>
          </span>
        </button>
      </div>
    );
  }

  const done = task.phase === "done";
  const title = done
    ? t("install.progress.done")
    : task.phase === "cloning"
      ? (task.percent != null
        ? t("install.progress.cloningWithPercent", { percent: task.percent })
        : t("install.progress.cloning"))
      : t("install.progress.installing");

  // 安装阶段优先显示"第 N/M 个 · 技能名"，比 git 的原始输出更可读。
  const subtitle = task.phase === "installing" && task.index != null && task.total != null
    ? (task.itemName
      ? t("install.progress.item", { index: task.index, total: task.total, name: task.itemName })
      : t("install.progress.count", { index: task.index, total: task.total }))
    : task.detail;

  // 能算出百分比就画确定进度条，否则用脉冲条表示"进行中但不可量化"。
  const percent = done
    ? 100
    : task.percent ?? (task.phase === "installing" && task.index != null && task.total
      ? Math.round((task.index / task.total) * 100)
      : null);

  return (
    <div className="shrink-0 border-t border-border-subtle p-2.5">
      <div className="flex items-start gap-1">
        <button
          type="button"
          onClick={() => navigate("/install")}
          title={t("install.progress.viewProgress")}
          className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {done
              ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
              : <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />}
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-secondary">{title}</span>
          </span>
          <span className="block h-1 w-full overflow-hidden rounded-full bg-border-subtle">
            {percent != null
              ? <span className="block h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${percent}%` }} />
              : <span className="block h-full w-1/3 animate-pulse rounded-full bg-accent" />}
          </span>
          {subtitle && (
            <span className="block truncate text-[11px] text-muted" title={subtitle}>{subtitle}</span>
          )}
        </button>
        <button
          type="button"
          onClick={dismissTask}
          aria-label={t("install.progress.dismiss")}
          className="mt-1 rounded p-1 text-faint outline-none transition-colors hover:bg-surface-hover hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
