// 为字体切换验收准备隔离数据：一个纯英文技能（散文 + 行内代码 + 带语言标记的代码块 + 表格），
// 覆盖应用中全部"英文展示"区域。只写入 output/font-verify/data，不接触用户真实技能库。
import fs from "node:fs";
import path from "node:path";
import { Store } from "../../backend/store.mjs";
import { Library } from "../../backend/library.mjs";

const root = path.resolve("output/font-verify/data");
fs.rmSync(root, { recursive: true, force: true });
const home = path.join(root, "home");
fs.mkdirSync(home, { recursive: true });

const store = new Store({ directory: path.join(home, ".skills-manager"), home });
store.setSetting("backup_auto_enabled", "off");
store.setSetting("backup_first_run_prompt", "fresh");
store.setSetting("sync_mode", "copy");

const document = `---
name: animation-vocabulary
description: Reverse-lookup glossary that turns a vague description of a web animation or motion effect into its exact term.
---

# Animation Vocabulary

Turn a vague description of a motion effect into the precise term, so you know exactly what to ask for. The glossary below is the authoritative vocabulary; quote it verbatim when a term matches.

## Quick Start

The user describes an effect loosely. You return the matching term(s) in this format:

\`\`\`
**Stagger** — Animate several items one after another with a small delay between each, creating a cascade.
\`\`\`

If several terms could fit, list the best match first, then one or two alternates with a one-line note on how they differ.

## Instructions

1. **Read for intent, not keywords.** Users describe what they *see* or *feel* ("springy", "slides off", "draws itself in"), not the technical name.
2. **Quote the glossary verbatim.** Its descriptions are authoritative — use them as-is, don't paraphrase.
3. **Disambiguate close terms.** When two compete (*Pop in* vs *Bounce*), contrast them so the user can pick.
4. **When nothing matches exactly,** name the closest term and say plainly it is an approximation.

## Example

User: "What's it called when a popover seems to grow out of the button you clicked instead of from its middle?" Output:

\`\`\`ts
// Origin-aware entrance: scale from the trigger's bounding box
const origin = trigger.getBoundingClientRect();
popover.style.transformOrigin = \`\${origin.left}px \${\${origin.top}px\`;
popover.animate([{ transform: "scale(0.6)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 180, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
\`\`\`

Skill documents live in \`~/.codex/skills/<name>/SKILL.md\`; Codex and DSH both read \`SKILL.md\`, so re-import after editing.

## Glossary

A curated snapshot mirroring the project's \`/vocabulary\` page; keep the two in sync when either changes.

| Term | Meaning |
| --- | --- |
| Pop in | Grows out of the element that triggered it |
| Rubber-banding | Resistance and snap-back when you drag past a boundary |
| Shared element transition | An element travels and transforms from one position to another |
`;

const upstream = path.join(root, "upstream");
const skillPath = path.join(upstream, "animation-vocabulary");
fs.mkdirSync(skillPath, { recursive: true });
fs.writeFileSync(path.join(skillPath, "SKILL.md"), document);

const library = new Library(store);
const skill = await library.installLocal(skillPath);
store.setTags(skill.id, ["animation", "glossary"]);
const presetId = store.activeScenarioId() ?? store.presets()[0].id;
store.addSkillToPreset(skill.id, presetId);
store.scenarioSkillTools(presetId, skill.id);
console.log("skill:", skill.id, skill.name, "preset:", presetId);
