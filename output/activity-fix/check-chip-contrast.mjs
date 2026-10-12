// 调用记录徽章的对比度自检：把 activityTone.ts 里的 class 串解析成实际颜色，
// 按「徽章底色叠在卡片底上」做 alpha 合成，再算 WCAG 对比度（正文阈值 4.5）。
// 色值不手抄：tailwind 内置色从 node_modules 读，项目 token 从 src/index.css 读。
// 用法：node output/activity-fix/check-chip-contrast.mjs
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const colors = require("tailwindcss/colors");
const ROOT = new URL("../../", import.meta.url);
const read = relative => fs.readFileSync(new URL(relative, ROOT), "utf8");

// ── 1. 取主题 token ─────────────────────────────────────────────
function cssBlock(css, pattern) {
  const match = pattern.exec(css);
  if (!match) throw new Error(`index.css 里找不到 ${pattern}`);
  const start = css.indexOf("{", match.index), end = css.indexOf("}", start);
  const out = {};
  for (const item of css.slice(start + 1, end).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[item[1]] = item[2].trim();
  return out;
}
const css = read("src/index.css");
const THEMES = { 浅色: cssBlock(css, /:root\s*\{/), 深色: cssBlock(css, /\.dark\s*\{/) };

const TOKEN = {
  surface: "--color-surface", "bg-secondary": "--color-bg-secondary", background: "--color-bg",
  "surface-hover": "--color-surface-hover", "surface-active": "--color-surface-active",
  "accent-bg": "--color-accent-bg", "accent-dark": "--color-accent-dark", "accent-light": "--color-accent-light",
  tertiary: "--color-text-tertiary", secondary: "--color-text-secondary", muted: "--color-text-muted",
};

// ── 2. 颜色解析与对比度 ─────────────────────────────────────────
const hex = value => {
  const raw = value.replace("#", "").trim();
  const full = raw.length === 3 ? raw.split("").map(c => c + c).join("") : raw;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
};
function parse(value) {
  const rgba = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/i.exec(value);
  if (rgba) return { rgb: [+rgba[1], +rgba[2], +rgba[3]].map(Math.round), alpha: rgba[4] === undefined ? 1 : +rgba[4] };
  if (value.startsWith("#")) return { rgb: hex(value), alpha: 1 };
  throw new Error(`无法解析颜色：${value}`);
}
const over = (fg, bg, alpha) => fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));
const lum = ([r, g, b]) => {
  const f = c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

// 把 class 串里的 paint 类解析为「底板上的实际颜色」。底板 = 该主题的 --color-surface（卡片底）。
function paint(classString, theme) {
  const tokens = theme.values;
  const resolve = name => {
    if (TOKEN[name]) {
      const value = tokens[TOKEN[name]];
      if (!value) throw new Error(`主题缺少 token ${TOKEN[name]}`);
      return parse(value);
    }
    const m = /^([a-z]+)-(\d+)$/.exec(name);
    if (m && colors[m[1]]?.[m[2]]) return { rgb: hex(colors[m[1]][m[2]]), alpha: 1 };
    throw new Error(`未知颜色 ${name}`);
  };
  const pick = (prefix, dark) => classString.split(/\s+/).find(c => c.startsWith((dark ? "dark:" : "") + prefix + "-") && (dark || !c.startsWith("dark:")));
  const plate = parse(tokens["--color-surface"]);
  // 底色类没有 dark: 变体（只有文字色分主题），所以深色下要回退到同一串里的普通 bg- 类。
  const bgClass = pick("bg", theme.dark) ?? pick("bg", false) ?? "bg-transparent";
  if (bgClass === "bg-transparent") throw new Error(`缺少 bg 类：${classString}`);
  const [bgName, bgAlpha] = bgClass.replace("dark:", "").slice(3).split("/");
  const bgColor = resolve(bgName);
  const background = over(bgColor.rgb, plate.rgb, bgColor.alpha * (bgAlpha ? +bgAlpha / 100 : 1));
  const textClass = pick("text", theme.dark) ?? pick("text", false);
  if (!textClass) throw new Error(`缺少 text 类：${classString}`);
  const textColor = resolve(textClass.replace("dark:", "").slice(5).split("/")[0]);
  return { background, foreground: over(textColor.rgb, background, textColor.alpha), bgName: bgName + (bgAlpha ? `/${bgAlpha}` : "") };
}

// ── 3. 从 activityTone.ts 取徽章分组 ────────────────────────────
const tone = read("src/lib/activityTone.ts");
const groups = {};
for (const m of tone.matchAll(/export const (\w+_TONE)[^=]*=\s*\{([\s\S]*?)\n\};/g)) {
  const entries = {};
  for (const item of m[2].matchAll(/^\s*(\w+):\s*"([^"]+)"/gm)) entries[item[1]] = item[2];
  groups[m[1]] = entries;
}

// ── 4. 计算并断言 ───────────────────────────────────────────────
const THRESHOLD = 4.5;
let failed = 0;
console.log(`WCAG 对比度（正文阈值 ${THRESHOLD}）—— 底色按「卡片底 --color-surface 上叠徽章底色」合成\n`);
for (const [group, entries] of Object.entries(groups)) {
  console.log(`【${group}】`);
  for (const [key, classString] of Object.entries(entries)) {
    const cells = [];
    for (const theme of [{ name: "浅色", dark: false, values: THEMES.浅色 }, { name: "深色", dark: true, values: THEMES.深色 }]) {
      const { background, foreground, bgName } = paint(classString, theme);
      const ratio = contrast(foreground, background);
      const ok = ratio >= THRESHOLD;
      if (!ok) failed++;
      const paint6 = c => "#" + c.map(v => v.toString(16).padStart(2, "0")).join("");
      cells.push(`${theme.name} ${ratio.toFixed(2)} ${ok ? "✓" : "✗"} (${paint6(foreground)} on ${paint6(background)} ${bgName})`);
    }
    console.log(`  ${key.padEnd(10)} ${cells.join("   ")}`);
  }
}
console.log(failed ? `\n${failed} 项低于 ${THRESHOLD}，需要调整配色。` : `\n全部通过（≥ ${THRESHOLD}）。`);
process.exit(failed ? 1 : 0);
