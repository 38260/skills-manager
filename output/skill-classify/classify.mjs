// 给现有技能库打分类。按技能名映射到分类，写入 skill_tags（分类）与 skill_categories（分类目录）。
// 幂等：重复执行结果一致；已有标签会被保留（合并而不是覆盖）。
// 用法：node output/skill-classify/classify.mjs [--dry]
import { Store } from "../../backend/store.mjs";

const DIRECTORY = process.env.SKILLS_MANAGER_DIR || "C:/Users/luckyzyb/.skills-manager";
const dry = process.argv.includes("--dry");

const CATEGORIES = ["界面设计", "动效与视频", "前端验证", "文档与演示", "学术科研", "调研与学习", "生活与资讯", "工程与发布", "流程与协作", "图像理解"];

const PLAN = {
  "界面设计": [
    "apple-design",              // Apple 界面与动效设计方法论
    "design-pitfall-cn",         // 中文前端设计避坑清单
    "design-taste-frontend",     // 落地页/作品集的反 AI 味设计
    "emil-design-eng",           // Emil Kowalski 的 UI 打磨哲学
    "figma",                     // 读取 Figma 设计上下文与资源
    "frontend-design",           // 新界面/改版的视觉设计指导
    "my-ui-skill",               // UI 预设台
    "web-design-guidelines",     // Web Interface Guidelines 走查
    "zyb-ui-design",             // 偏好的前端界面设计流程
  ],
  "动效与视频": [
    "animation-vocabulary",      // 动效术语反查
    "find-animation-opportunities", // 找该动但没动的地方
    "improve-animations",        // 动效改造方案
    "review-animations",         // 动效代码评审
    "remotion-data-race-video",  // 数据竞速/柱状图动画视频
  ],
  "前端验证": [
    "browser-smoke-test",        // 单文件 HTML 无头冒烟测试
    "css-state-probe-cdp",       // CDP 实测 CSS 状态与布局
    "local-webapp-headless-behavior-verify", // 本地 B/S 应用行为级回归
    "playwright",                // 终端驱动真实浏览器
    "vue-ui-audit-headless",     // Vue3 + Tailwind 界面走查
    "zustand-store-headless-regression", // zustand store 回归自检
  ],
  "文档与演示": [
    "archify",                   // 架构图/流程图/时序图
    "dashi-ppt",                 // HTML 演示文稿，可导出 PPTX/PDF
    "paper-reading-notes-docx",  // 顶会论文研读记录 docx
    "pdf",                       // PDF 阅读/创建/校对
    "pdf-converter",             // MinerU 驱动的 PDF 转换
    "ppt-template-replica",      // 在线 PPT 模板像素级复刻
  ],
  "学术科研": [
    "ai-rereseach",              // AI 综述反向核验
    "ai-rereseach-v2",           // 同上，v2
    "nature-figure-qa-gate",     // 投稿级科研图 + 三道 QA
    "thesis-review",             // 中文学位论文评审
    "verified-literature-survey",// 零编造文献调研
    "zotero-pdf-annotate",       // 驱动 Zotero 批量高亮
  ],
  "调研与学习": [
    "domain-learning-companion", // 新领域入门资料清单
    "product-research",          // 产品立项前竞品研究
    "project-idea-research",     // 想法查重（重点 GitHub）
  ],
  "生活与资讯": [
    "aihot",                     // 中文 AI 资讯/热点/日报
    "eli5",                      // 用大白话解释概念
    "recipe",                    // 菜谱搜索与整理
  ],
  "工程与发布": [
    "github-api-push-when-git-blocked", // git 不通时走 GitHub API 推送
    "github-release-asset-update",      // 更新 Release 资产
    "pyinstaller-desktop-packaging",    // Python Web 打包成 Windows 桌面 exe
    "windows-disk-usage-audit",         // 磁盘占用只读审计
    "windows-safe-delete-pack-workaround", // 沙箱打包 EBUSY 绕行
  ],
  "流程与协作": [
    "codex-with-chatgpt",        // ChatGPT 当规划与评审大脑
    "craft-prompts",             // 提示词创建与优化
    "find-skills",               // 场景驱动的技能发现
    "grill-me",                  // 用连续追问打磨方案
    "pebrel-runtime",            // 从 Codex/Claude Code 控制 Pebrel 终端
    "report-driven-batch-fix",   // 按报告逐项修复并提交
    "self-improving-agent",      // 沉淀经验与纠错
    "skill-creator",             // 创建/改进技能
  ],
  "图像理解": [
    "claude-vision-skill",       // 给不识图的模型加识图能力
  ],
};

const store = new Store({ directory: DIRECTORY });
const skills = store.skills();
const byName = new Map(skills.map(skill => [skill.name, skill]));

const planned = new Map();
for (const [category, names] of Object.entries(PLAN)) {
  if (!CATEGORIES.includes(category)) throw new Error(`分类未在目录中声明：${category}`);
  for (const name of names) {
    if (!byName.has(name)) throw new Error(`技能不存在：${name}`);
    if (planned.has(name)) throw new Error(`技能被重复分类：${name}`);
    planned.set(name, category);
  }
}
const missing = skills.filter(skill => !planned.has(skill.name)).map(skill => skill.name);
if (missing.length) throw new Error(`以下技能未分类：${missing.join(", ")}`);

const previousCatalog = store.categories();
console.log(`技能 ${skills.length} 个，分类 ${CATEGORIES.length} 个；原分类目录 ${JSON.stringify(previousCatalog)}`);
for (const category of CATEGORIES) {
  const names = PLAN[category];
  console.log(`  ${category.padEnd(6)} ${String(names.length).padStart(2)} 个  ${names.join(", ")}`);
}
if (dry) { console.log("\n--dry 模式：未写入。"); store.close(); process.exit(0); }

store.setSetting("skill_categories", JSON.stringify(CATEGORIES));
let changed = 0;
for (const [name, category] of planned) {
  const skill = byName.get(name);
  const merged = [...new Set([...(skill.tags ?? []), category])];
  if (merged.length !== (skill.tags ?? []).length || merged.some(tag => !(skill.tags ?? []).includes(tag))) {
    store.setTags(skill.id, merged);
    changed++;
  }
}
console.log(`\n已写入：分类目录 ${CATEGORIES.length} 项，更新技能 ${changed} 个。`);
console.log("复核：", JSON.stringify(store.categories()));
const counts = {};
for (const skill of store.skills()) for (const tag of skill.tags) counts[tag] = (counts[tag] ?? 0) + 1;
console.log("分类计数：", JSON.stringify(counts));
store.close();
