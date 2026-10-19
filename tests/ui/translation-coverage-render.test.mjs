import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";

const RESOURCES = {
  "dashboard.translationCoverage": "中文译本",
  "dashboard.translationMissingUnit": "个待译",
  "dashboard.translationLoading": "统计中…",
  "dashboard.translationError": "译文统计读取失败",
  "dashboard.translationNoEnglish": "暂无英文原文的技能",
  "dashboard.translationAllDone": "{{count}} 个英文技能都有中文版",
  "dashboard.translationMissing": "{{count}} 个英文技能还没有中文版",
  "dashboard.translationListTrigger": "{{count}} 个待译，查看名单",
  "dashboard.translationListTitle": "待译技能",
  "dashboard.translationListHint": "点击技能名打开详情，粘贴中文版即可",
  "dashboard.translationStale": "{{count}} 个译文对应旧原文，待复核",
};

const skill = (id, name, displayName) => ({ id, name, display_name: displayName ?? name, targets: [] });

const coverage = (overrides = {}) => ({
  total: 4, english: 3, chinese: 1, unknown: 0,
  translated: 1, missing: 1, stale: 0,
  missing_skills: [{ id: "m", name: "missing-one" }],
  stale_skills: [],
  ...overrides,
});

async function loadComponent() {
  const modulePath = path.join(process.cwd(), "tests/ui", `translation-coverage-render-${process.pid}.mjs`);
  const result = await build({
    entryPoints: ["src/components/TranslationCoverage.tsx"],
    bundle: true,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    packages: "external",
    write: false,
  });
  fs.writeFileSync(modulePath, result.outputFiles[0].text, { flag: "wx" });
  try {
    return await import(pathToFileURL(modulePath).href);
  } finally {
    fs.unlinkSync(modulePath);
  }
}

async function withI18n(node) {
  const i18n = createInstance();
  const dashboard = Object.fromEntries(Object.entries(RESOURCES).map(([key, value]) => [key.replace("dashboard.", ""), value]));
  await i18n.init({ lng: "zh", resources: { zh: { translation: { dashboard } } } });
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, node));
}

test("统计卡：数字取缺译数，进度取已译/英文技能，并给出展开入口", async () => {
  const { TranslationCoverageCard } = await loadComponent();
  const html = await withI18n(createElement(TranslationCoverageCard, {
    coverage: coverage(), loading: false, error: "",
    skills: [skill("m", "missing-one", "待译技能"), skill("d", "done-one")],
    onOpenSkill() {},
  }));

  assert.match(html, /中文译本/);
  // 大字是缺译数（1），不是英文技能总数（3）
  assert.match(html, />1<span class="text-\[13px\] font-normal text-muted">个待译/);
  assert.match(html, /33\.3%/);
  assert.match(html, /role="progressbar"[^>]*aria-valuenow="33\.3"/);
  assert.match(html, /1 个待译，查看名单/);
  assert.match(html, /aria-expanded="false"/);
  // 名单未展开时不渲染面板
  assert.doesNotMatch(html, /待译技能<\/p>/);
});

test("全部译完时给确认文案，不再出现展开入口", async () => {
  const { TranslationCoverageCard } = await loadComponent();
  const html = await withI18n(createElement(TranslationCoverageCard, {
    coverage: coverage({ translated: 3, missing: 0, missing_skills: [] }),
    loading: false, error: "", skills: [], onOpenSkill() {},
  }));

  assert.match(html, /3 个英文技能都有中文版/);
  assert.match(html, /100%/);
  assert.doesNotMatch(html, /查看名单/);
});

test("加载中与读取失败都不显示 0，避免把「没读到」当成「做完了」", async () => {
  const { TranslationCoverageCard } = await loadComponent();
  const loading = await withI18n(createElement(TranslationCoverageCard, {
    coverage: null, loading: true, error: "", skills: [], onOpenSkill() {},
  }));
  assert.match(loading, /统计中…/);
  assert.match(loading, />—<span/);
  assert.doesNotMatch(loading, />0<span/);

  const failed = await withI18n(createElement(TranslationCoverageCard, {
    coverage: null, loading: false, error: "boom", skills: [], onOpenSkill() {},
  }));
  assert.match(failed, /译文统计读取失败/);
  assert.match(failed, />—<span/);
});

test("原文已改的译文单独提示，不混进缺译数字", async () => {
  const { TranslationCoverageCard } = await loadComponent();
  const html = await withI18n(createElement(TranslationCoverageCard, {
    coverage: coverage({ missing: 0, missing_skills: [], stale: 1, stale_skills: [{ id: "s", name: "stale-one" }] }),
    loading: false, error: "", skills: [skill("s", "stale-one")], onOpenSkill() {},
  }));
  assert.match(html, />0<span/);
  assert.match(html, /1 个译文对应旧原文，待复核/);
});

test("待译名单：条数与缺译技能一致，别名优先，点击可打开详情", async () => {
  const { TranslationCoveragePanel } = await loadComponent();
  const skills = [skill("m1", "missing-one", "待译技能"), skill("m2", "missing-two")];
  const html = await withI18n(createElement(TranslationCoveragePanel, {
    id: "panel", skills, onOpenSkill() {}, onClose() {},
  }));

  assert.match(html, /id="panel"/);
  assert.match(html, /待译技能<\/p>/);
  assert.equal([...html.matchAll(/<li>/g)].length, 2);
  assert.match(html, /title="待译技能"/);
  assert.match(html, /missing-two/);
  assert.doesNotMatch(html, /missing-one/);
  assert.equal([...html.matchAll(/<button type="button"/g)].length, 2);
  assert.match(html, /粘贴中文版即可/);
});

test("三语言都补齐了译本统计文案", () => {
  for (const lang of ["zh", "en", "zh-TW"]) {
    const resources = JSON.parse(fs.readFileSync(path.join(process.cwd(), `src/i18n/${lang}.json`), "utf8"));
    for (const key of Object.keys(RESOURCES).map(name => name.replace("dashboard.", ""))) {
      assert.equal(typeof resources.dashboard[key], "string", `${lang} 缺少 dashboard.${key}`);
      assert.ok(resources.dashboard[key].length > 0, `${lang} 的 dashboard.${key} 为空`);
    }
  }
});
