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
  "dashboard.pendingDeploy": "{{count}} 项未部署",
  "dashboard.pendingDeployTitle": "未部署的技能",
  "dashboard.pendingDeployHint": "点击技能名查看详情并部署",
  "dashboard.allDeployed": "全部技能已部署",
};

const skill = (id, name, displayName) => ({ id, name, display_name: displayName ?? name, targets: [] });

async function loadComponent() {
  const modulePath = path.join(process.cwd(), "tests/ui", `pending-deploy-render-${process.pid}.mjs`);
  const result = await build({
    entryPoints: ["src/components/PendingDeployList.tsx"],
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
  // 键名里带 dashboard. 前缀，这里还原成嵌套结构，和真实资源一致。
  const dashboard = Object.fromEntries(Object.entries(RESOURCES).map(([key, value]) => [key.replace("dashboard.", ""), value]));
  await i18n.init({ lng: "zh", resources: { zh: { translation: { dashboard } } } });
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, node));
}

test("未部署名单：条数与技能数一致，别名优先展示，含标题与提示", async () => {
  const { PendingDeployPanel } = await loadComponent();
  const skills = [skill("a", "alpha-layout", "版式规范"), skill("b", "beta-review")];
  const html = await withI18n(createElement(PendingDeployPanel, { id: "panel", skills, onOpenSkill() {}, onClose() {} }));

  assert.match(html, /id="panel"/);
  assert.match(html, /未部署的技能/);
  // 两个技能各一行，别名生效，原名不出现。
  assert.equal([...html.matchAll(/<li>/g)].length, 2);
  assert.match(html, /title="版式规范"/);
  assert.match(html, /beta-review/);
  assert.doesNotMatch(html, /alpha-layout/);
  assert.match(html, /点击技能名查看详情并部署/);
  // 每行都是可点击入口（指向详情），不是纯文本。
  assert.equal([...html.matchAll(/<button type="button"/g)].length, 2);
});

test("未部署名单：只有一处按钮，且不渲染面板本体", async () => {
  const { PendingDeployList } = await loadComponent();
  const html = await withI18n(
    createElement(PendingDeployList, { skills: [skill("a", "alpha"), skill("b", "beta")], onOpenSkill() {} })
  );

  assert.match(html, /2 项未部署/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-controls="[^"]+"/);
  assert.doesNotMatch(html, /未部署的技能/);
});

test("全部部署完成时给出确认文案，不再出现展开入口", async () => {
  const { PendingDeployList } = await loadComponent();
  const html = await withI18n(createElement(PendingDeployList, { skills: [], onOpenSkill() {} }));

  assert.match(html, /全部技能已部署/);
  assert.doesNotMatch(html, /<button/);
});

test("三语言都补齐了未部署名单相关文案", () => {
  for (const lang of ["zh", "en", "zh-TW"]) {
    const resources = JSON.parse(fs.readFileSync(path.join(process.cwd(), `src/i18n/${lang}.json`), "utf8"));
    for (const key of ["pendingDeploy", "pendingDeployTitle", "pendingDeployHint", "allDeployed"]) {
      assert.equal(typeof resources.dashboard[key], "string", `${lang} 缺少 dashboard.${key}`);
      assert.ok(resources.dashboard[key].length > 0, `${lang} 的 dashboard.${key} 为空`);
    }
  }
});
