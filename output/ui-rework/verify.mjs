// 单进程验收：脚本自己 spawn 本地服务与 headless Chrome，跑完一并结束，避免分离进程被环境回收。
// 用法：node output/ui-rework/verify.mjs
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const root = path.resolve("output/ui-rework/data");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixture.json"), "utf8"));
const evidence = path.resolve("output/ui-rework/evidence");
fs.mkdirSync(evidence, { recursive: true });

const NODE = process.execPath;
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"]
  .find(candidate => fs.existsSync(candidate));
if (!CHROME) throw new Error("未找到 Chrome 或 Edge");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  probe.on("error", reject);
});

const results = [];
const record = (name, value) => { results.push({ name, value }); console.log(`· ${name}: ${JSON.stringify(value)}`); };

const port = await freePort();
const debugPort = await freePort();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ui-rework-profile-"));

const server = spawn(NODE, ["backend/server.mjs", "--port", String(port), "--directory", fixture.directory, "--home", fixture.home],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = "";
server.stdout.on("data", chunk => { serverLog += chunk; });
server.stderr.on("data", chunk => { serverLog += chunk; });

let chrome;
let ws;
try {
  const deadline = Date.now() + 20000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* 还没起来 */ }
    if (Date.now() > deadline) throw new Error(`本地服务未就绪：${serverLog}`);
    await sleep(150);
  }

  chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*", `--user-data-dir=${profile}`,
    "--window-size=1536,1024", "about:blank"], { stdio: "ignore" });

  let target = null;
  for (let index = 0; index < 80 && !target; index++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      target = list.find(item => item.type === "page" && item.webSocketDebuggerUrl);
    } catch { /* 等 Chrome 打开调试端口 */ }
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
    if (result.exceptionDetails) throw new Error(`表达式执行失败：${result.exceptionDetails.text} ${JSON.stringify(result.result?.value ?? "")}`);
    return result.result?.value;
  };
  const shoot = async (name, { full = false } = {}) => {
    const height = full
      ? Math.max(600, Math.min(await evaluate("Math.max(document.scrollingElement.scrollHeight, document.body.scrollHeight)"), 8000))
      : null;
    const shot = await send("Page.captureScreenshot", {
      format: "png",
      ...(full ? { captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1536, height, scale: 1 } } : {}),
    });
    fs.writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(shot.data, "base64"));
    console.log(`  SHOT ${name}.png${full ? ` (${height}px)` : ""}`);
  };
  const goto = async url => { await send("Page.navigate", { url }); await sleep(2200); };

  await send("Page.enable");
  await send("Runtime.enable");

  // ── 浅色主题 ──
  await goto(`http://127.0.0.1:${port}/my-skills`);
  await evaluate(`localStorage.setItem('theme','light')`);
  await goto(`http://127.0.0.1:${port}/my-skills`);

  // 仪表盘「近期动态」：技能更新与调用记录合并成一条时间线
  await goto(`http://127.0.0.1:${port}/`);
  record("近期动态内容", await evaluate(`(() => {
    const heading = [...document.querySelectorAll('h2')].find(el => el.textContent.includes('近期动态'));
    const panel = heading?.parentElement?.parentElement?.querySelector('.app-panel');
    const rows = panel ? [...panel.querySelectorAll('[role="button"]')] : [];
    const tools = ['Codex','DSH','ZCode','Qoder','WorkBuddy'];
    return {
      hasHeading: !!heading,
      hasViewAll: !!(heading?.parentElement && [...heading.parentElement.querySelectorAll('button')].some(b => b.textContent.includes('查看全部'))),
      rows: rows.length,
      firstRow: rows[0] ? rows[0].textContent.replace(/\\s+/g, ' ').trim().slice(0, 60) : null,
      activityRows: rows.filter(row => tools.some(name => row.textContent.includes(name))).length,
      triggerChips: rows.filter(row => /手动触发|自动触发|来源未知/.test(row.textContent)).length,
      times: rows.map(row => row.lastElementChild?.textContent).filter(Boolean).length,
    };
  })()`));
  await shoot("07_dashboard_light");

  await goto(`http://127.0.0.1:${port}/my-skills`);
  record("技能卡片可见", await evaluate(`[...document.querySelectorAll('.app-panel')].some(el => el.textContent.includes('ui-guide'))`));

  // 打开详情
  await evaluate(`(() => { const card = [...document.querySelectorAll('.app-panel')].find(el => el.textContent.includes('ui-guide')); card.click(); return true; })()`);
  await sleep(1400);
  record("详情页已打开", await evaluate(`!!document.querySelector('.skill-detail-shell')`));

  // 行内代码可读性：计算样式对比（浅色主题应为深绿文字 + 浅绿底）
  record("行内代码样式", await evaluate(`(() => {
    const code = [...document.querySelectorAll('.skill-detail-markdown .skill-md-inline-code')][0];
    if (!code) return null;
    const style = getComputedStyle(code);
    return { text: code.textContent, color: style.color, background: style.backgroundColor, border: style.borderColor };
  })()`));

  // 目录：层级与长标题折行
  record("目录条目", await evaluate(`(() => {
    const nav = document.querySelector('aside nav[aria-label]');
    const items = nav ? [...nav.querySelectorAll('button')] : [];
    const long = items.map(button => button.querySelector('span')).find(span => span && span.textContent.includes('符号链接'));
    return { count: items.length, longLines: long ? Math.round(long.getBoundingClientRect().height / 18) : null,
      longClamped: long ? getComputedStyle(long).webkitLineClamp : null };
  })()`));

  // 项目结构：默认展开，文件可点击（拦截 fetch，避免真的拉起系统程序）
  record("项目结构", await evaluate(`(() => {
    const aside = document.querySelector('aside');
    const rows = [...aside.querySelectorAll('button')].filter(button => /^[a-zA-Z._-]+$/.test(button.querySelector('span')?.textContent ?? '') === false ? false : true);
    const names = [...aside.querySelectorAll('button span')].map(span => span.textContent).filter(text => ['SKILL.md','references','scripts','LICENSE','tokens.md','checklist.md','build.sh'].includes(text));
    return { names };
  })()`));

  // 部署到工具：默认折叠，展开后只出现已安装工具
  record("部署默认折叠", await evaluate(`(() => {
    const aside = document.querySelector('aside');
    const header = [...aside.querySelectorAll('button')].find(button => button.textContent.includes('部署到工具'));
    const expanded = header?.getAttribute('aria-expanded');
    const toggles = aside.querySelectorAll('[role="switch"], input[type="checkbox"]').length;
    return { expanded, switchesWhileCollapsed: toggles };
  })()`));
  await evaluate(`(() => { const aside = document.querySelector('aside'); const header = [...aside.querySelectorAll('button')].find(button => button.textContent.includes('部署到工具')); header.click(); return true; })()`);
  await sleep(700);
  record("展开后的工具行", await evaluate(`(() => {
    const aside = document.querySelector('aside');
    const header = [...aside.querySelectorAll('button')].find(button => button.textContent.includes('部署到工具'));
    const text = aside.textContent;
    return { expanded: header.getAttribute('aria-expanded'),
      names: ['Codex','DSH','ZCode','Qoder','WorkBuddy'].filter(name => text.includes(name)),
      hiddenUnavailable: !text.includes('Cursor') && !text.includes('Claude Code') && !text.includes('不可用') };
  })()`));
  await shoot("01_detail_light");
  await shoot("01_detail_light_full", { full: true });
  // 右栏内容较长：滚到底部确认"部署到工具（已展开）"与"来源信息"布局正常。
  record("右栏区块", await evaluate(`(() => {
    const aside = document.querySelector('aside');
    return { scrollHeight: aside.scrollHeight, clientHeight: aside.clientHeight,
      sections: [...aside.querySelectorAll('section h3')].map(h => h.textContent.trim()) };
  })()`));
  await evaluate(`(() => { const aside = document.querySelector('aside'); aside.scrollTop = aside.scrollHeight; return true; })()`);
  await sleep(500);
  await shoot("01b_detail_sidebar_bottom");

  // 项目结构：点击文件应发出 open_path 请求（拦截 fetch，不真打开）
  await evaluate(`(() => { window.__calls = []; const original = window.fetch;
    window.fetch = function (input, init) { const url = String(input);
      if (url.indexOf('/api/invoke/open_path') >= 0) { window.__calls.push({ url, body: init && init.body });
        return Promise.resolve(new Response(JSON.stringify({ ok: true, data: { path: 'stub', reveal: false } }), { status: 200, headers: { 'Content-Type': 'application/json' } })); }
      return original.apply(this, arguments); }; return true; })()`);
  await evaluate(`(() => { const aside = document.querySelector('aside');
    const button = [...aside.querySelectorAll('button')].find(item => [...item.querySelectorAll('span')].some(span => span.textContent === 'SKILL.md'));
    if (button) button.click(); return !!button; })()`);
  await sleep(600);
  record("点击结构文件调用 open_path", await evaluate(`window.__calls.map(call => JSON.parse(call.body))`));

  // 反向断言：点击目录行只做展开/收起，不应触发打开文件。
  await evaluate(`window.__calls = []`);
  record("点击目录行不打开文件", {
    clicked: await evaluate(`(() => { const aside = document.querySelector('aside');
      const button = [...aside.querySelectorAll('button')].find(item => [...item.querySelectorAll('span')].some(span => span.textContent === 'references'));
      if (button) button.click(); return !!button; })()`),
    calls: await evaluate(`window.__calls.length`),
  });

  // 无语言标记的代码块按块级渲染，不出现绿色行内标签。
  record("无语言代码块渲染", await evaluate(`(() => {
    const blocks = [...document.querySelectorAll('.skill-detail-markdown pre')];
    const plain = blocks.find(pre => pre.textContent.includes('plain code block'));
    return { hasPlainBlock: !!plain, inlineChipInsidePre: plain ? !!plain.querySelector('.skill-md-inline-code') : null };
  })()`));

  // 来源信息：打开来源目录
  await evaluate(`(() => { const aside = document.querySelector('aside');
    const button = [...aside.querySelectorAll('button')].find(item => item.textContent.includes('打开来源目录'));
    if (button) button.click(); return !!button; })()`);
  await sleep(600);
  record("打开来源目录调用", await evaluate(`window.__calls.map(call => JSON.parse(call.body))`));

  // 调用记录页签：内嵌展示，不跳转
  const pathBefore = await evaluate("location.pathname");
  await evaluate(`(() => { const tab = [...document.querySelectorAll('header button')].find(button => button.textContent.trim() === '调用记录'); tab.click(); return true; })()`);
  await sleep(1600);
  record("调用记录内嵌", {
    pathBefore,
    pathAfter: await evaluate("location.pathname"),
    rows: await evaluate(`document.querySelectorAll('.skill-detail-main button[aria-expanded]').length`),
    firstSkill: await evaluate(`document.querySelector('.skill-detail-main button[aria-expanded] span')?.textContent ?? null`),
  });
  await shoot("02_activity_inline");
  // 展开第一条记录详情
  await evaluate(`(() => { const row = document.querySelector('.skill-detail-main button[aria-expanded]'); row.click(); return true; })()`);
  await sleep(700);
  record("记录详情字段", await evaluate(`(() => { const panel = document.querySelector('.skill-detail-main dl'); return panel ? [...panel.querySelectorAll('dt')].map(dt => dt.textContent) : null; })()`));
  await shoot("03_activity_detail");

  // ── 深色主题 ──
  await evaluate(`localStorage.setItem('theme','dark')`);
  await goto(`http://127.0.0.1:${port}/my-skills`);
  await evaluate(`(() => { const card = [...document.querySelectorAll('.app-panel')].find(el => el.textContent.includes('ui-guide')); card.click(); return true; })()`);
  await sleep(1500);
  record("深色行内代码样式", await evaluate(`(() => {
    const code = document.querySelector('.skill-detail-markdown .skill-md-inline-code');
    const style = getComputedStyle(code);
    return { color: style.color, background: style.backgroundColor };
  })()`));
  await shoot("04_detail_dark");
  await shoot("04_detail_dark_full", { full: true });

  // 深色下的调用记录：详情页内嵌 + 调用记录页，逐项取计算样式核对对比度
  await evaluate(`(() => { const tab = [...document.querySelectorAll('header button')].find(button => button.textContent.trim() === '调用记录'); tab.click(); return true; })()`);
  await sleep(1600);
  record("深色内嵌调用记录", await evaluate(`(() => {
    const row = document.querySelector('.skill-detail-main button[aria-expanded]');
    if (!row) return null;
    const style = getComputedStyle(row);
    const name = row.querySelector('span');
    return { rowBg: style.backgroundColor, nameColor: getComputedStyle(name).color, icon: !!row.querySelector('img, svg') };
  })()`));
  await shoot("08_activity_inline_dark");
  // 展开一行，核对展开态的绿底与左侧绿线
  await evaluate(`(() => { const row = document.querySelector('.skill-detail-main button[aria-expanded]'); row.click(); return true; })()`);
  await sleep(700);
  record("深色展开态", await evaluate(`(() => {
    const row = document.querySelector('.skill-detail-main button[aria-expanded="true"]');
    const style = getComputedStyle(row);
    return { background: style.backgroundColor, leftBorder: style.borderLeftColor, leftWidth: style.borderLeftWidth };
  })()`));
  await shoot("09_activity_detail_dark");

  // ── 调用记录页（参考图样式的扁平分组） ──
  await goto(`http://127.0.0.1:${port}/skill-activity`);
  record("调用记录页（深色）", await evaluate(`(() => {
    const row = document.querySelector('section button[aria-expanded]');
    const style = row ? getComputedStyle(row) : null;
    return { rows: document.querySelectorAll('section button[aria-expanded]').length,
      hasCardFrames: document.querySelectorAll('section .rounded-xl').length,
      rowBg: style ? style.backgroundColor : null,
      icons: row ? !!row.querySelector('img, svg') : null };
  })()`));
  await shoot("10_activity_page_dark");
  await shoot("10_activity_page_dark_full", { full: true });
  await evaluate(`(() => { const row = document.querySelector('section button[aria-expanded]'); if (row) row.click(); return true; })()`);
  await sleep(700);
  await shoot("11_activity_page_dark_detail");

  await evaluate(`localStorage.setItem('theme','light')`);
  await goto(`http://127.0.0.1:${port}/skill-activity`);
  record("调用记录页（浅色）", await evaluate(`(() => {
    const row = document.querySelector('section button[aria-expanded]');
    const style = row ? getComputedStyle(row) : null;
    const badge = row ? [...row.querySelectorAll('span')].find(span => span.className.includes('border')) : null;
    return { rowBg: style ? style.backgroundColor : null,
      badgeColor: badge ? getComputedStyle(badge).color : null,
      icons: row ? !!row.querySelector('img, svg') : null };
  })()`));
  await shoot("05_activity_page_light");
  await evaluate(`(() => { const row = document.querySelector('section button[aria-expanded]'); if (row) row.click(); return true; })()`);
  await sleep(700);
  await shoot("05b_activity_page_light_detail");

  await goto(`http://127.0.0.1:${port}/skill-activity?skill=ui-guide`);
  await shoot("06_activity_deeplink");

  fs.writeFileSync(path.join(evidence, "report.json"), JSON.stringify(results, null, 2));
  console.log("\n验收完成，结果写入 output/ui-rework/evidence/report.json");
} catch (error) {
  console.error("验收中断：", error.message);
  fs.writeFileSync(path.join(evidence, "report.json"), JSON.stringify({ error: error.message, results }, null, 2));
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* 忽略关闭异常 */ }
  chrome?.kill();
  server.kill();
  await sleep(400);
  fs.rmSync(profile, { recursive: true, force: true });
  process.exit(process.exitCode ?? 0);
}
