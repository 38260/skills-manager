// 在列宽 seed 造好的库上补「描述 + 别名」：seed 里 installLocal 不会写 description，
// 没有描述就无从验证描述高亮。这里用 store.setProfile 把可控文案写进去。
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Store } from "../../backend/store.mjs";

const root = path.resolve(process.env.LIBHL_DATA);
const home = path.join(root, "home");
const store = new Store({ directory: path.join(home, ".skills-manager"), home });

const PROFILES = [
  // 故意写得很长，且把「清单」埋在后半段：复现用户搜 git 时高亮落在描述深处的场景。
  ["gamma-a11y", { customDescription: "面向评审与开发共用的无障碍自检流程说明，覆盖键盘可达性、焦点顺序、语义标签、颜色对比度与动效减弱等检查项；执行时先按页面结构逐层走查，再对关键交互补做屏幕阅读器复核，发现问题记录到待办并跟踪整改。检查清单：焦点顺序、对比度、标签" }],
  ["beta-review", { alias: "评审助手", customDescription: "发布前逐项核对界面细节" }],
];

for (const [name, profile] of PROFILES) {
  const skill = store.skills().find(item => item.name === name);
  if (!skill) throw new Error(`seed 里没有技能：${name}`);
  store.setProfile(skill.id, profile);
}

// installLocal 也不写原始 description，这里再补一条「原描述命中」的样本（搜索 pyramid）。
const { DatabaseSync } = await import("node:sqlite");
const dbFile = path.join(home, ".skills-manager", "skills-manager.db");
const db = new DatabaseSync(dbFile);
db.prepare("UPDATE skills SET description = ? WHERE name = ?").run(
  "Testing pyramid guidance and fixtures for UI components, covering unit, integration and end-to-end layers.",
  "theta-testing",
);
db.close();

const after = store.skills().filter(skill => ["gamma-a11y", "beta-review", "theta-testing"].includes(skill.name));
console.log(JSON.stringify(after.map(s => ({ name: s.name, alias: s.alias, description: s.description, display_description: s.display_description }))));
