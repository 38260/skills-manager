// Dashboard / 调用记录重构验收：隔离 fixture + 真实后端 + 无头 Chrome。
// 覆盖：真实部署后的统计口径、页头与统计卡、双栏联动、筛选/分页交互、深色与窄窗口、长路径不溢出。
// 用法：node output/dash-activity-rework/verify.mjs [tag]
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const tag = process.argv[2] ?? "run";
const root = path.resolve("output/dash-activity-rework");
const home = path.join(root, "data", "home");
const evidence = path.join(root, "evidence", tag);
fs.mkdirSync(evidence, { recursive: true });

const NODE = process.execPath;
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"]
  .find(candidate => fs.existsSync(candidate));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  probe.on("error", reject);
});

const port = await freePort();
const debugPort = await freePort();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dash-activity-profile-"));

const server = spawn(NODE, ["backend/server.mjs", "--port", String(port), "--directory", path.join(home, ".skills-manager"), "--home", home],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = "";
server.stdout.on("data", chunk => { serverLog += chunk; });
server.stderr.on("data", chunk => { serverLog += chunk; });

const results = [];
const record = (name, value) => { results.push({ name, value }); console.log(`· ${name}: ${JSON.stringify(value)}`); };
const invoke = (command, args = {}) => fetch(`http://127.0.0.1:${port}/api/invoke/${command}`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-skills-manager-client": "webview" },
  body: JSON.stringify(args),
}).then(async response => {
  const payload = await response.json();
  if (!payload?.ok) throw new Error(`${command}: ${payload?.message ?? response.status}`);
  return payload.data;
});

let chrome;
let ws;
try {
  const deadline = Date.now() + 20000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* 未就绪 */ }
    if (Date.now() > deadline) throw new Error(`本地服务未就绪：${serverLog}`);
    await sleep(150);
  }

  // ── 真实部署：让"部署覆盖"与"Agent 部署"拿到非零数据 ──
  const skills = await invoke("get_managed_skills");
  const byName = (name) => skills.find(skill => skill.name === name);
  const plan = [
    ["alpha-layout", ["codex", "qoder", "zcode"]],
    ["beta-review", ["codex", "qoder"]],
    ["gamma-a11y", ["codex", "claude_code"]],
    ["delta-motion", ["codex"]],
    ["epsilon-copy", ["claude_code"]],
  ];
  for (const [name, tools] of plan) {
    const skill = byName(name);
    if (!skill) continue;
    for (const tool of tools) await invoke("sync_skill_to_tool", { skillId: skill.id, tool });
  }
  const deployed = await invoke("get_managed_skills");
  record("部署后 targets 非零的技能数", deployed.filter(skill => skill.targets.length > 0).length);

  chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*", `--user-data-dir=${profile}`,
    "--window-size=1536,1024", "about:blank"], { stdio: "ignore" });

  let target = null;
  for (let index = 0; index < 160 && !target; index++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      target = list.find(item => item.type === "page" && item.webSocketDebuggerUrl);
    } catch { /* 等端口 */ }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error("找不到可调试的页面目标");

  ws = new WebSocket(target.webSocketDebuggerUrl);
  if (ws.readyState !== 1) await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (entry) { pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); }
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params ?? {} }));
  });
  const evaluate = async (expression, awaitPromise = false) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
    if (result.exceptionDetails) throw new Error(`表达式执行失败：${result.exceptionDetails.text}`);
    return result.result?.value;
  };
  const goto = async url => { await send("Page.navigate", { url }); await sleep(2600); };
  const shoot = async name => {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(shot.data, "base64"));
  };
  const viewport = async (width, height) => {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await goto(`http://127.0.0.1:${port}/`);
  await evaluate(`localStorage.setItem('theme','light')`);

  // ── 1. Dashboard ──
  await goto(`http://127.0.0.1:${port}/`);
  record("Dashboard 页头", await evaluate(`(() => {
    const header = document.querySelector('header');
    return { text: header.textContent.replace(/\\s+/g,' ').trim().slice(0, 80),
      actions: [...header.querySelectorAll('button')].map(b => b.textContent.trim()) };
  })()`));
  record("三张统计卡", await evaluate(`(() => {
    const cards = [...document.querySelectorAll('section.app-panel')].slice(0, 3);
    return cards.map(card => ({
      label: card.querySelector('.app-section-title')?.textContent?.trim(),
      text: card.textContent.replace(/\\s+/g,' ').trim().slice(0, 60),
      icons: card.querySelectorAll('img, svg').length,
      bar: card.querySelector('[style*="width"]')?.getAttribute('style') ?? null,
    }));
  })()`));
  record("Agent 部署行", await evaluate(`(() => {
    const panel = [...document.querySelectorAll('section')].find(s => s.textContent.includes('Agent 部署'));
    const rows = [...panel.querySelectorAll('li button')].map(b => b.textContent.replace(/\\s+/g,' ').trim());
    return { rows: rows.length, first: rows.slice(0, 3), footer: panel.textContent.includes('管理工作区') };
  })()`));
  record("同步提醒", await evaluate(`(() => {
    const card = [...document.querySelectorAll('section')].find(s => s.textContent.includes('同步提醒'));
    return card ? { present: true, text: card.textContent.replace(/\\s+/g,' ').trim().slice(0, 80), action: !!card.querySelector('button') } : { present: false };
  })()`));
  record("近期动态", await evaluate(`(() => {
    const panel = [...document.querySelectorAll('section')].find(s => s.textContent.includes('近期动态'));
    const tabs = [...panel.querySelectorAll('[role="tab"]')].map(b => b.textContent.trim());
    const rows = panel.querySelectorAll('[role="button"]').length;
    const first = panel.querySelector('[role="button"]')?.textContent.replace(/\\s+/g,' ').trim().slice(0, 60);
    return { tabs, rows, first, viewAll: panel.textContent.includes('查看全部') };
  })()`));
  record("引导条", await evaluate(`(() => {
    const bar = [...document.querySelectorAll('div')].find(el => el.className.includes('border-l-accent') && el.textContent.includes('让你的 Agent 管理 Skills'));
    return bar ? { present: true, actions: [...bar.querySelectorAll('button')].map(b => b.textContent.trim() || b.title) } : { present: false };
  })()`));
  await shoot("01_dashboard_light");

  // 动态筛选：切到「技能调用」应只剩调用记录
  await evaluate(`(() => { const panel=[...document.querySelectorAll('section')].find(s=>s.textContent.includes('近期动态')); const tab=[...panel.querySelectorAll('[role="tab"]')].find(b=>b.textContent.includes('技能调用')); tab.click(); return true; })()`);
  await sleep(500);
  record("动态页签筛选", await evaluate(`(async () => {
    const panel = [...document.querySelectorAll('section')].find(s => s.textContent.includes('近期动态'));
    const count = () => panel.querySelectorAll('[role=button]').length;
    const all = count();
    const updates = [...panel.querySelectorAll('[role=tab]')].find(b => b.textContent.includes('技能更新'));
    updates.click();
    await new Promise(r => setTimeout(r, 400));
    const rows = [...panel.querySelectorAll('[role=button]')].map(r => r.textContent);
    return { all, updates: rows.length, noTriggerChips: !rows.some(text => /手动触发|自动触发|来源未知/.test(text)) };
  })()`, true));

  await evaluate(`localStorage.setItem('theme','dark')`);
  await goto(`http://127.0.0.1:${port}/`);
  await shoot("02_dashboard_dark");
  await evaluate(`localStorage.setItem('theme','light')`);
  await viewport(960, 1000);
  await goto(`http://127.0.0.1:${port}/`);
  record("窄窗口(960) 首页横向溢出", await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`));
  await shoot("03_dashboard_narrow");
  await viewport(1536, 1024);

  // ── 2. 调用记录 ──
  await goto(`http://127.0.0.1:${port}/skill-activity`);
  record("统计四项", await evaluate(`(() => {
    const stat = [...document.querySelectorAll('div.bg-surface')].filter(el => el.querySelector('.app-section-title, div'));
    const wrap = document.querySelector('section[aria-label]');
    return [...wrap.querySelectorAll(':scope > div > div')].map(el => el.textContent.replace(/\\s+/g,' ').trim());
  })()`));
  record("口径说明与来源摘要", await evaluate(`(() => {
    const text = document.body.textContent.replace(/\\s+/g,' ');
    return { countNote: text.includes('仅请求不计入实际使用'), sourceSummary: /\\d+ 个来源已启用/.test(text), manage: text.includes('管理来源') };
  })()`));
  record("筛选条控件", await evaluate(`(() => {
    const selects = [...document.querySelectorAll('select')].map(s => s.options[0].textContent);
    return { selects, moreFilters: !!document.body.textContent.match(/更多筛选/), hasSearch: !!document.querySelector('input[placeholder*="技能"]') };
  })()`));
  record("列表页签与行数", await evaluate(`(() => {
    const panel = [...document.querySelectorAll('section')].find(s => s.querySelector('button[aria-pressed]'));
    const tabs = [...panel.querySelectorAll('[role="tab"]')].map(b => b.textContent.replace(/\\s+/g,' ').trim());
    const rows = panel.querySelectorAll('button[aria-pressed]').length;
    const header = [...panel.querySelectorAll('div')].map(d => d.textContent).find(x => x?.includes('技能 / 项目'));
    return { tabs, rows, header: header?.replace(/\\s+/g,' ').trim().slice(0, 60) };
  })()`));
  record("首行选中态", await evaluate(`(() => {
    const row = document.querySelector('button[aria-pressed="true"]');
    if (!row) return null;
    const style = getComputedStyle(row);
    return { text: row.textContent.replace(/\\s+/g,' ').trim().slice(0, 50), bg: style.backgroundColor, leftBorder: style.borderLeftColor, leftWidth: style.borderLeftWidth };
  })()`));
  record("右栏详情字段", await evaluate(`(() => {
    const aside = document.querySelector('aside');
    const sections = [...aside.querySelectorAll('section h4')].map(h => h.textContent.trim());
    return { title: aside.querySelector('h2')?.textContent.trim(), sections,
      hasStatusNote: aside.textContent.includes('不代表整个任务成功'),
      hasReveal: aside.textContent.includes('在文件夹中显示'),
      hasOpenSkill: aside.textContent.includes('打开技能详情'),
      monoPaths: [...aside.querySelectorAll('p.font-mono')].map(p => p.textContent.trim().slice(0, 40)) };
  })()`));
  await shoot("04_activity_light");

  // 长路径是否折行不溢出（详情面板内的等宽路径元素）
  record("详情长路径溢出", await evaluate(`(() => {
    const aside = document.querySelector('aside');
    return [...aside.querySelectorAll('p.font-mono')].map(p => ({ text: p.textContent.trim().slice(0, 30), overflow: p.scrollWidth - p.clientWidth }));
  })()`));

  // 选中联动：点第三行，右栏标题应变化
  record("选中联动", await evaluate(`(async () => {
    const rows = [...document.querySelectorAll('button[aria-pressed]')];
    const before = document.querySelector('aside h3')?.textContent?.trim() ?? null;
    const third = rows[2].textContent.replace(/\\s+/g,' ').trim().slice(0, 30);
    rows[2].click();
    await new Promise(r => setTimeout(r, 300));
    return { before, third, after: document.querySelector('aside h3')?.textContent?.trim() ?? null,
      selectedCount: document.querySelectorAll('button[aria-pressed="true"]').length };
  })()`, true));

  // 关联技能的行：右栏应出现「打开技能详情」入口（未关联的行显示提示）
  record("关联行的技能详情入口", await evaluate(`(async () => {
    const rows = [...document.querySelectorAll('button[aria-pressed]')];
    const row = rows.find(r => r.textContent.includes('alpha-layout'));
    if (!row) return { found: false };
    row.click();
    await new Promise(r => setTimeout(r, 400));
    const aside = document.querySelector('aside');
    return { found: true, title: aside.querySelector('h3')?.textContent?.trim(), openSkill: aside.textContent.includes('打开技能详情'), unlinked: aside.textContent.includes('未关联技能库') };
  })()`, true));

  // 类型页签：点「仅请求」后行数应等于该类型计数
  record("类型页签筛选", await evaluate(`(async () => {
    const panel = [...document.querySelectorAll('section')].find(s => s.querySelector('button[aria-pressed]'));
    const tab = [...panel.querySelectorAll('[role="tab"]')].find(b => b.textContent.includes('仅请求'));
    tab.click();
    await new Promise(r => setTimeout(r, 1200));
    const rows = [...document.querySelectorAll('button[aria-pressed]')];
    const kinds = rows.map(r => r.textContent).filter(t => t.includes('仅请求')).length;
    return { pressed: tab.getAttribute('aria-selected'), rows: rows.length, allAreRequests: kinds === rows.length };
  })()`, true));

  await goto(`http://127.0.0.1:${port}/skill-activity`);
  // 状态筛选：结果=失败 + 筛选
  record("状态筛选（失败）", await evaluate(`(async () => {
    const select = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent.includes('失败')));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(select, 'failed');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    const apply = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '筛选');
    apply.click();
    await new Promise(r => setTimeout(r, 1500));
    const rows = [...document.querySelectorAll('button[aria-pressed]')];
    return { rows: rows.length, allFailed: rows.every(r => r.textContent.includes('失败')), total: document.body.textContent.match(/共 (\\d+) 条记录/)?.[1] };
  })()`, true));

  // 更多筛选：展开后出现项目与日期
  record("更多筛选展开", await evaluate(`(async () => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('更多筛选'));
    btn.click();
    await new Promise(r => setTimeout(r, 300));
    const text = document.body.textContent;
    return { project: !!document.querySelector('input[placeholder*="项目"]'), from: !!document.querySelector('input[type="date"]'),
      labels: ['项目', '开始日期', '结束日期'].filter(label => text.includes(label)) };
  })()`, true));
  await shoot("05_activity_filtered");

  // 重置后翻页
  await goto(`http://127.0.0.1:${port}/skill-activity`);
  record("分页", await evaluate(`(async () => {
    const pagination = document.body.textContent.match(/第 (\\d+) \\/ (\\d+) 页/);
    const next = [...document.querySelectorAll('button[aria-label]')].find(b => b.getAttribute('aria-label') === '下一页');
    next.click();
    await new Promise(r => setTimeout(r, 1200));
    const after = document.body.textContent.match(/第 (\\d+) \\/ (\\d+) 页/);
    const rows = document.querySelectorAll('button[aria-pressed]').length;
    return { before: pagination?.slice(1), after: after?.slice(1), rowsOnPage2: rows };
  })()`, true));

  await evaluate(`localStorage.setItem('theme','dark')`);
  await goto(`http://127.0.0.1:${port}/skill-activity`);
  await shoot("06_activity_dark");
  await evaluate(`localStorage.setItem('theme','light')`);

  // 窄窗口：列表在上、详情在下；表格列收敛
  await viewport(960, 1000);
  await goto(`http://127.0.0.1:${port}/skill-activity`);
  record("窄窗口(960) 布局", await evaluate(`(() => {
    const list = [...document.querySelectorAll('section')].find(s => s.querySelector('button[aria-pressed]')).getBoundingClientRect();
    const aside = document.querySelector('aside').getBoundingClientRect();
    const row = document.querySelector('button[aria-pressed]');
    return { stacked: aside.top >= list.bottom - 1, listWidth: Math.round(list.width), asideWidth: Math.round(aside.width),
      headerVisible: [...document.querySelectorAll('[role="presentation"]')].some(d => d.textContent.includes('技能 / 项目')),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  })()`));
  await shoot("07_activity_narrow");
  await viewport(1536, 1024);

  fs.writeFileSync(path.join(evidence, "report.json"), JSON.stringify({ tag, results }, null, 2));
  console.log(`\n[${tag}] 验收完成 → ${path.join("output/dash-activity-rework/evidence", tag)}`);
} catch (error) {
  console.error("验收中断：", error.message);
  fs.writeFileSync(path.join(evidence, "report.json"), JSON.stringify({ tag, error: error.message, results }, null, 2));
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* 忽略 */ }
  chrome?.kill();
  server.kill();
  await sleep(400);
  fs.rmSync(profile, { recursive: true, force: true });
  process.exit(process.exitCode ?? 0);
}
