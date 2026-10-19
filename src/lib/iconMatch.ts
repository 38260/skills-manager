/**
 * Icon/topic matching, kept free of React and lucide imports so both the
 * preset and the skill library share one rule table — and it stays unit
 * testable from plain Node.
 */
export const ICON_KEYWORD_RULES: Array<{ key: string; keywords: string[] }> = [
  { key: "briefcase", keywords: ["工作", "work", "office", "client", "商务", "办公"] },
  { key: "book-open", keywords: ["学习", "study", "learn", "course", "research", "文档", "doc", "document", "阅读", "read", "论文", "paper", "综述", "文献"] },
  { key: "folder-git-2", keywords: ["开源", "opensource", "open source", "github", "仓库", "repo", "git"] },
  { key: "plane", keywords: ["旅行", "travel", "trip", "holiday"] },
  { key: "code-2", keywords: ["开发", "code", "build", "app", "前端", "frontend", "backend", "重构", "refactor", "typescript", "react"] },
  { key: "bot", keywords: ["agent", "agents", "ai", "assistant", "机器人", "智能体", "技能", "skill"] },
  { key: "brain", keywords: ["thinking", "reason", "brainstorm", "思考", "推理", "头脑风暴"] },
  { key: "terminal", keywords: ["cli", "terminal", "shell", "command", "命令行", "终端", "脚本", "script"] },
  { key: "database", keywords: ["data", "database", "sql", "数据", "表格", "excel", "csv", "json"] },
  { key: "chart-bar", keywords: ["analytics", "metric", "report", "dashboard", "分析", "统计", "报表", "看板"] },
  { key: "search", keywords: ["research", "search", "调查", "检索", "搜索", "爬虫", "crawl", "竞品"] },
  { key: "sparkles", keywords: ["creative", "content", "copy", "创意", "生成", "generate", "文案", "写作", "write"] },
  { key: "lightbulb", keywords: ["idea", "ideas", "灵感", "点子", "方案", "建议"] },
  { key: "target", keywords: ["goal", "target", "okr", "目标", "定位"] },
  { key: "calendar", keywords: ["plan", "planning", "schedule", "calendar", "计划", "排期", "日程"] },
  { key: "home", keywords: ["personal", "home", "life", "个人", "生活"] },
  { key: "heart", keywords: ["health", "fitness", "wellness", "健康"] },
  { key: "zap", keywords: ["automation", "automate", "workflow", "自动化", "流水线", "pipeline"] },
  { key: "bug", keywords: ["debug", "bug", "fix", "修复", "调试", "排错"] },
  { key: "shield", keywords: ["security", "secure", "安全", "审计", "audit", "评审", "review", "合规"] },
  { key: "lock", keywords: ["privacy", "secret", "密钥", "加密", "隐私", "credential", "认证"] },
  { key: "cloud", keywords: ["cloud", "deploy", "云", "部署", "发布", "上线", "release"] },
  { key: "server", keywords: ["infra", "infrastructure", "server", "ops", "运维", "备份", "backup"] },
  { key: "cpu", keywords: ["performance", "perf", "optimiz", "性能", "优化", "加速", "硬件", "gpu"] },
  { key: "flask-conical", keywords: ["experiment", "lab", "test", "实验", "测评", "评测", "测试", "eval", "benchmark", "验证"] },
  { key: "notebook-pen", keywords: ["笔记", "note", "write", "journal", "记录", "日志", "log", "草稿", "draft"] },
  { key: "blocks", keywords: ["system", "架构", "模块", "component", "组件", "结构"] },
  { key: "palette", keywords: ["设计", "design", "brand", "ui", "ux", "视觉", "海报", "ppt", "幻灯片", "slide", "配色", "主题"] },
  { key: "wrench", keywords: ["tool", "tools", "工具", "转换", "convert", "格式", "utility", "辅助"] },
];

/** Presets need an icon even when nothing matches; skills show the neutral marker instead. */
export const PRESET_ICON_FALLBACK_KEY = "briefcase";
export const SKILL_AUTO_ICON_KEY = "layers";

/** First icon whose keywords appear in the text; `null` when nothing matches. */
export function matchIconKeyByWords(text: string): string | null {
  const haystack = text.toLowerCase();
  return ICON_KEYWORD_RULES.find((rule) =>
    rule.keywords.some((keyword) => haystack.includes(keyword))
  )?.key ?? null;
}

/** Topic tags of one library that describe the same thing as a given logo. */
export function tagsMatchingIcon(key: string, allTags: string[]): string[] {
  return allTags.filter((tag) => matchIconKeyByWords(tag) === key);
}

export interface SkillIconSource {
  icon?: string | null;
  name?: string | null;
  alias?: string | null;
  display_name?: string | null;
  description?: string | null;
  custom_description?: string | null;
  display_description?: string | null;
  tags?: string[] | null;
}

/**
 * The logo a skill would get with no explicit pick: the first icon matching its
 * tags, then its name, then its description. Tags come first because the user
 * curated them, and a curated tag should not be overruled by whatever the
 * upstream author wrote in `SKILL.md`.
 */
export function autoMatchSkillIconKey(skill?: SkillIconSource | null): string {
  if (!skill) return SKILL_AUTO_ICON_KEY;
  for (const haystack of [
    ...(skill.tags ?? []),
    `${skill.display_name ?? ""} ${skill.name ?? ""} ${skill.alias ?? ""}`,
    `${skill.display_description ?? ""} ${skill.description ?? ""} ${skill.custom_description ?? ""}`,
  ]) {
    const matched = matchIconKeyByWords(haystack);
    if (matched) return matched;
  }
  return SKILL_AUTO_ICON_KEY;
}

/** An explicit pick always wins; an unknown key is filtered out where the icon is resolved. */
export function inferSkillIconKey(skill?: SkillIconSource | null): string {
  const explicit = skill?.icon?.trim();
  return explicit || autoMatchSkillIconKey(skill);
}
