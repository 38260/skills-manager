import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../utils";
import type { ManagedSkill } from "../lib/tauri";

interface Props {
  /** 没有任何部署目标的技能：数量与名单都由它派生，避免和统计卡各算一遍。 */
  skills: ManagedSkill[];
  onOpenSkill: (skillId: string) => void;
}

/**
 * 「N 项未部署」的展开入口：点开直接列出是哪几个技能，而不是只给一个数字。
 * 行点击复用全局技能详情弹层，用户在原页面就能完成部署。
 */
export function PendingDeployList({ skills, onOpenSkill }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 展开的面板先消费 Escape，避免同时触发外层（详情弹层/多选）的关闭。
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  // 在详情里补齐部署后列表会清空：这里用派生值收口，不必在 effect 里回写 state。
  const expanded = open && skills.length > 0;

  if (skills.length === 0) {
    return (
      <p className="mt-2 flex items-center gap-1 text-[12px] text-tertiary">
        <Check className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
        {t("dashboard.allDeployed")}
      </p>
    );
  }

  return (
    <div ref={containerRef} className="relative mt-2">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "inline-flex items-center gap-1 rounded text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
          expanded ? "text-secondary" : "text-tertiary hover:text-secondary"
        )}
      >
        {t("dashboard.pendingDeploy", { count: skills.length })}
        <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded && <PendingDeployPanel id={panelId} skills={skills} onOpenSkill={onOpenSkill} onClose={() => setOpen(false)} />}
    </div>
  );
}

interface PanelProps {
  id: string;
  skills: ManagedSkill[];
  onOpenSkill: (skillId: string) => void;
  onClose: () => void;
}

/** 名单本体：单独导出，便于按名称/顺序做无 DOM 的渲染断言。 */
export function PendingDeployPanel({ id, skills, onOpenSkill, onClose }: PanelProps) {
  const { t } = useTranslation();
  return (
    <div
      id={id}
      className="absolute left-0 top-full z-30 mt-1.5 w-[248px] rounded-lg border border-border bg-surface p-1 shadow-lg"
    >
      <p className="px-2 pb-1 pt-1 text-[11px] font-medium text-tertiary">{t("dashboard.pendingDeployTitle")}</p>
      <ul className="max-h-[212px] overflow-y-auto">
        {skills.map((skill) => {
          const name = skill.display_name || skill.name;
          return (
            <li key={skill.id}>
              <button
                type="button"
                title={name}
                onClick={() => {
                  onClose();
                  onOpenSkill(skill.id);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover"
              >
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-secondary">{name}</span>
                <ArrowRight className="h-3 w-3 shrink-0 text-faint" />
              </button>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-border-subtle px-2 pb-1 pt-1.5 text-[11px] leading-4 text-faint">
        {t("dashboard.pendingDeployHint")}
      </p>
    </div>
  );
}
