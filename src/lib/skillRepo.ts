import type { ManagedSkill } from "./tauri";

/**
 * 技能名 → 上游 GitHub 仓库。
 *
 * 只收录**逐个核对过内容**的条目：拉取候选仓库的文件树 → 找到同名 `SKILL.md` →
 * 与本机该技能的 description 前 100 字逐字比对。
 *
 * 为什么不按名字直接关联：skills.sh 上「同名」根本不算证据 —— 实测
 * `pdf` / `skill-creator` / `find-skills` / `aihot` / `figma` 都存在**同名但不同物**的仓库
 * （例如 `pdf` 与 `anthropics/skills` 的 pdf 描述完全不同）。指到一个错的仓库比留空更糟，
 * 所以推不出来就留空。
 *
 * 核对脚本与完整结论：`output/skill-source/verify-repos.mjs`
 * （2026-10-12 核对 53 个本地技能，确证 14 个，其余留空）。
 */
export const SKILL_REPOS: Record<string, string> = {
  "animation-vocabulary": "https://github.com/emilkowalski/skills",
  "apple-design": "https://github.com/emilkowalski/skills",
  "emil-design-eng": "https://github.com/emilkowalski/skills",
  "find-animation-opportunities": "https://github.com/emilkowalski/skills",
  "improve-animations": "https://github.com/emilkowalski/skills",
  "review-animations": "https://github.com/emilkowalski/skills",
  "frontend-design": "https://github.com/anthropics/skills",
  "skill-creator": "https://github.com/anthropics/skills",
  "figma": "https://github.com/openai/skills",
  "pdf": "https://github.com/openai/skills",
  "playwright": "https://github.com/openai/skills",
  "grill-me": "https://github.com/mattpocock/skills",
  "archify": "https://github.com/tt-a1i/archify",
  "dashi-ppt": "https://github.com/chuspeeism/dashi-ppt-skill",
};

type SourceLike = Pick<ManagedSkill, "name" | "source_type" | "source_ref" | "source_ref_resolved">;

/**
 * 技能对应的 GitHub 仓库地址：先看技能自己记的来源（git / skills.sh 装的技能都带），
 * 推不出再查上面逐个核对过的映射；都没有返回 null（界面留空）。
 */
export function skillRepoUrl(skill: SourceLike): string | null {
  const raw = (skill.source_ref_resolved || skill.source_ref || "").trim();
  if (raw) {
    const fromUrl = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?]|$)/i.exec(raw);
    if (fromUrl) return `https://github.com/${fromUrl[1]}/${fromUrl[2]}`;
    // skills.sh 的来源串是 `owner/repo/skillId`（无协议），前两段就是仓库。
    if (skill.source_type === "skillssh") {
      const [owner, repo] = raw.split("/");
      if (owner && repo) return `https://github.com/${owner}/${repo}`;
    }
  }
  return SKILL_REPOS[skill.name] ?? null;
}

/** 仓库地址 → `owner/repo` 的展示形式。 */
export const repoLabel = (url: string) => url.replace(/^https?:\/\/github\.com\//, "");

/**
 * 市场（skills.sh）里的来源串转 GitHub 仓库。
 * 来源串通常是 `owner/repo`，但也会出现站点型来源（`smithery.ai/apple-design`、
 * `skills.volces.com/find-skills`、`open.feishu.cn/lark-doc`）—— 带点的那一段不是 GitHub 账号，
 * 这种一律返回 null，不给一个打不开的地址。
 */
export function marketRepoUrl(source: string): string | null {
  const [owner, repo] = source.split("/");
  if (!owner || !repo || owner.includes(".") || repo.includes(".")) return null;
  return `https://github.com/${owner}/${repo}`;
}
