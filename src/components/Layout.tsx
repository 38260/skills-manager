import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { StatusBanner } from "./StatusBanner";
import { CommandPalette } from "./CommandPalette";
import { SkillDetailPanel } from "./SkillDetailPanel";
import { useApp } from "../context/AppContext";
import { useTranslation } from "react-i18next";
import { useDragWindow } from "../hooks/useDragWindow";

export function Layout() {
  const { t } = useTranslation();
  const { appError, refreshAppData, detailSkillId, managedSkills, tools, projects, closeSkillDetail, refreshProjects } = useApp();
  const onDrag = useDragWindow();
  const navigate = useNavigate();
  const location = useLocation();
  // 顶部面包屑只在技能库页显示 —— 那是它出现得通顺的上下文。
  const detailSkill = location.pathname === "/my-skills" ? managedSkills.find(skill => skill.id === detailSkillId) : null;
  // 详情弹层本体：技能库页用自己那份（带部署开关、更新入口等页内交互），其余页面用这里这份。
  // 从前弹层被限定在技能库页渲染，导致从调用记录 / 工作台点「打开技能详情」只能靠换页实现，
  // 关掉后就停在技能库页、回不到原处。
  const floatingDetail = location.pathname === "/my-skills" ? null : managedSkills.find(skill => skill.id === detailSkillId) ?? null;

  // Cmd+, to open Settings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
        e.preventDefault();
        navigate("/settings");
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r") {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
        e.preventDefault();
        refreshAppData();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, refreshAppData]);

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-background text-primary">
      {/* Full-width top drag bar — spans sidebar + content, with bottom divider */}
      <div
        onMouseDown={onDrag}
        className="absolute inset-x-0 top-0 z-50 h-[28px] border-b border-border-subtle bg-bg-secondary"
      >
        {detailSkill && <div className="ml-[260px] flex h-full min-w-0 items-center gap-2 pr-8 text-[12px] text-muted">
          <span>{t("mySkills.title")}</span><span aria-hidden="true">/</span><span className="truncate">{detailSkill.name}</span>
        </div>}
      </div>
      <Sidebar />
      <div className="relative flex min-w-[600px] flex-1 flex-col overflow-hidden">
        <div id="page-scroll-container" className="flex-1 overflow-y-auto px-5 pb-5 pt-[calc(28px+20px)] scrollbar-hide">
          {/* 技能库与调用记录以表格化的列表为主，宽屏下放宽上限，避免右侧留下大片空白、
              也才放得下调用记录的分列（记录类型 / 触发方式 / 时间单行）；
              其余页面（仪表盘、设置等）保持 1200px，避免正文行过长影响阅读。 */}
          <div className={`mx-auto flex min-h-full flex-col gap-4 ${location.pathname === "/my-skills" ? "max-w-[1760px]" : location.pathname === "/skill-activity" ? "max-w-[1560px]" : "max-w-[1200px]"}`}>
            {appError ? (
              <StatusBanner
                compact
                title={t("common.dataOutOfDate")}
                description={appError}
                actionLabel={t("common.retry")}
                onAction={refreshAppData}
                tone="danger"
              />
            ) : null}
            <Outlet />
          </div>
        </div>
      </div>
      <CommandPalette />
      {floatingDetail && (
        <SkillDetailPanel
          key={floatingDetail.id}
          skill={floatingDetail}
          onClose={closeSkillDetail}
          tools={tools}
          projects={projects}
          onProjectsChanged={refreshProjects}
        />
      )}
    </div>
  );
}
