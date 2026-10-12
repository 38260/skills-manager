// 「技能库观感偏灰」诊断探针：真实应用（隔离 fixture）+ 无头 Chrome，
// 逐层 alpha 合成底色后计算 WCAG 对比度，并量化卡片/页面/边框的层次分离度。
// 用法：node output/ui-contrast/probe.mjs [tag]
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const tag = process.argv[2] ?? "run";
const root = path.resolve("output/ui-contrast");
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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ui-contrast-profile-"));

const server = spawn(NODE, ["backend/server.mjs", "--port", String(port), "--directory", path.join(home, ".skills-manager"), "--home", home],
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
  const goto = async url => { await send("Page.navigate", { url }); await sleep(2400); };
  const shoot = async name => {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(shot.data, "base64"));
  };

  await send("Page.enable");
  await send("Runtime.enable");

  // 颜色/对比度工具（注入页面，逐层 alpha 合成，避免半透明底算成假值）
  const UTIL = `
  window.__c = {
    parse(s) {
      if (!s) return null;
      if (s === 'transparent') return { r:0, g:0, b:0, a:0 };
      let m = s.match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/);
      if (m) return { r:+m[1], g:+m[2], b:+m[3], a:m[4]===undefined?1:+m[4] };
      m = s.match(/color\\(srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)(?:\\s*\\/\\s*([\\d.]+))?\\)/);
      if (m) return { r:+m[1]*255, g:+m[2]*255, b:+m[3]*255, a:m[4]===undefined?1:+m[4] };
      m = s.match(/^#([0-9a-f]{6})$/i);
      if (m) { const n = parseInt(m[1],16); return { r:(n>>16)&255, g:(n>>8)&255, b:n&255, a:1 }; }
      return null;
    },
    over(top, bottom) {
      if (!top) return bottom;
      const a = top.a === undefined ? 1 : top.a;
      if (a >= 1) return { r:top.r, g:top.g, b:top.b, a:1 };
      const mix = (t, b) => t * a + b * (1 - a);
      return { r:mix(top.r,bottom.r), g:mix(top.g,bottom.g), b:mix(top.b,bottom.b), a:1 };
    },
    // 从元素向上收集 backgroundColor，自画布白底逐层合成
    surfaceOf(el) {
      const stack = [];
      for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
        const c = window.__c.parse(getComputedStyle(node).backgroundColor);
        if (c && (c.a === undefined || c.a > 0)) stack.push(c);
      }
      let base = { r:255, g:255, b:255, a:1 };
      for (let i = stack.length - 1; i >= 0; i--) base = window.__c.over(stack[i], base);
      return base;
    },
    lum(c) {
      const f = v => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
      return 0.2126*f(c.r) + 0.7152*f(c.g) + 0.0722*f(c.b);
    },
    ratio(fg, bg) {
      const l1 = window.__c.lum(fg), l2 = window.__c.lum(bg);
      const hi = Math.max(l1,l2), lo = Math.min(l1,l2);
      return Math.round(((hi+0.05)/(lo+0.05)) * 100) / 100;
    },
    hex(c) { return '#' + [c.r,c.g,c.b].map(v => Math.round(v).toString(16).padStart(2,'0')).join(''); },
    // 采样一个元素：文字色 / 合成底 / 对比度 / 字号字重
    sample(el, label) {
      const cs = getComputedStyle(el);
      const fg = window.__c.parse(cs.color);
      const bg = window.__c.surfaceOf(el);
      const size = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      return {
        label,
        text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 42),
        color: cs.color, bgHex: window.__c.hex(bg),
        contrast: window.__c.ratio(fg, bg),
        fontSize: size, fontWeight: weight,
        required: large ? 3 : 4.5,
        pass: window.__c.ratio(fg, bg) >= (large ? 3 : 4.5),
      };
    },
  };`;

  await goto(`http://127.0.0.1:${port}/my-skills`);
  await evaluate(`localStorage.setItem('theme','light')`);
  await goto(`http://127.0.0.1:${port}/my-skills`);
  await evaluate(UTIL);

  const report = {};

  // ── 1. 层次分离度：页面 / 卡片 / 边框 / 侧边栏 ──
  report.surfaces = await evaluate(`(() => {
    const page = document.body;
    const card = document.querySelector('.app-panel');
    const cardCs = getComputedStyle(card);
    const aside = document.querySelector('.w-\\\\[220px\\\\]');
    const pageBg = window.__c.surfaceOf(page);
    const cardBg = window.__c.surfaceOf(card);
    const border = window.__c.parse(cardCs.borderTopColor);
    const sideBg = aside ? window.__c.surfaceOf(aside) : null;
    // 边框需要与它两侧的底色分别比较：卡片底与页面底
    return {
      pageBg: window.__c.hex(pageBg), cardBg: window.__c.hex(cardBg),
      sidebarBg: sideBg ? window.__c.hex(sideBg) : null,
      borderColor: cardCs.borderTopColor, borderWidth: cardCs.borderTopWidth,
      shadow: cardCs.boxShadow,
      卡片亮度: Math.round(window.__c.lum(cardBg) * 100) / 100,
      页面亮度: Math.round(window.__c.lum(pageBg) * 100) / 100,
      卡页亮度差: Math.round((window.__c.lum(cardBg) - window.__c.lum(pageBg)) * 1000) / 1000,
      边框对页面: window.__c.ratio(border, pageBg),
      边框对卡片: window.__c.ratio(border, cardBg),
      侧栏对页面: sideBg ? window.__c.ratio(sideBg, pageBg) : null,
      fontSmoothing: getComputedStyle(document.body).webkitFontSmoothing,
      letterSpacing: getComputedStyle(document.body).letterSpacing,
    };
  })()`);

  // ── 2. 卡片内每一层文字的对比度（含标题、别名、描述、作者、用量、标签） ──
  report.cardText = await evaluate(`(() => {
    const card = document.querySelector('.app-panel');
    const out = [];
    const title = card.querySelector('h3');
    if (title) out.push(window.__c.sample(title, '技能名 h3'));
    const alias = [...card.querySelectorAll('p')].find(p => p.className.includes('text-faint') && p.textContent.includes('名:'));
    if (alias) out.push(window.__c.sample(alias, '别名行'));
    const desc = [...card.querySelectorAll('p')].find(p => p.className.includes('text-muted'));
    if (desc) out.push(window.__c.sample(desc, '描述 p'));
    const author = [...card.querySelectorAll('p')].find(p => p.className.includes('text-faint') && p.textContent.includes('作者'));
    if (author) out.push(window.__c.sample(author, '作者行'));
    const usage = [...card.querySelectorAll('p')].find(p => p.textContent.includes('使用') || p.textContent.includes('从未'));
    if (usage) out.push(window.__c.sample(usage, '用量行'));
    const tag = card.querySelector('.rounded-full.border');
    if (tag) out.push(window.__c.sample(tag, '标签胶囊'));
    const source = [...card.querySelectorAll('span,p')].find(el => /local|git|skills\\.sh/.test(el.textContent.trim()) && el.textContent.trim().length < 12);
    if (source) out.push(window.__c.sample(source, '来源徽标'));
    return out;
  })()`);

  // ── 3. 页面级文字（筛选条 / 页头 / 空态） ──
  report.pageText = await evaluate(`(() => {
    const out = [];
    const search = document.querySelector('input.app-input');
    if (search) out.push(window.__c.sample(search, '搜索框占位符'));
    const chips = [...document.querySelectorAll('button')].filter(b => ['全部','当前 Preset 已启用','当前 Preset 未启用'].includes(b.textContent.trim()));
    for (const chip of chips) out.push(window.__c.sample(chip, '筛选胶囊'));
    const header = document.querySelector('.app-page-title');
    if (header) out.push(window.__c.sample(header, '页标题'));
    const sectionish = [...document.querySelectorAll('button,span')].find(el => ['本地','导入','Git','skills.sh','未分类','自定义','新增分类'].includes(el.textContent.trim()));
    if (sectionish) out.push(window.__c.sample(sectionish, '筛选条次级按钮'));
    return out;
  })()`);

  // ── 4. 侧边栏 Preset 段：单 Preset 时应隐藏；筛选条应出现新建入口 ──
  report.presetSection = await evaluate(`(() => {
    const side = document.querySelector('.w-\\\\[220px\\\\]');
    const sideButtons = side ? [...side.querySelectorAll('button')] : [];
    const sideText = side ? side.textContent : '';
    const newPresetBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '新建 Preset');
    const sideNewPreset = sideButtons.some(b => b.textContent.trim() === '新建 Preset');
    return {
      侧栏是否出现Preset标题: /Preset/.test([...side.querySelectorAll('button span')].map(s => s.textContent).join('|')),
      侧栏是否出现Default行: sideButtons.some(b => b.textContent.trim().startsWith('Default')),
      侧栏是否还给新建入口: sideNewPreset,
      技能库筛选条有新建Preset: !!newPresetBtn && !side.contains(newPresetBtn),
      新建按钮类名: newPresetBtn ? newPresetBtn.className.split(' ').filter(c => c.startsWith('app-')).join(' ') : null,
      侧栏文本片段: sideText.slice(0, 60),
    };
  })()`);

  await shoot("01_list_light");
  await evaluate(`localStorage.setItem('theme','dark')`);
  await goto(`http://127.0.0.1:${port}/my-skills`);
  await evaluate(UTIL);
  report.darkSurfaces = await evaluate(`(() => {
    const pageBg = window.__c.surfaceOf(document.body);
    const card = document.querySelector('.app-panel');
    const cardBg = window.__c.surfaceOf(card);
    const title = card.querySelector('h3');
    const desc = [...card.querySelectorAll('p')].find(p => p.className.includes('text-muted'));
    return {
      pageBg: window.__c.hex(pageBg), cardBg: window.__c.hex(cardBg),
      borderColor: getComputedStyle(card).borderTopColor,
      卡页亮度差: Math.round((window.__c.lum(cardBg) - window.__c.lum(pageBg)) * 1000) / 1000,
      标题: title ? window.__c.sample(title, '技能名 h3') : null,
      描述: desc ? window.__c.sample(desc, '描述 p') : null,
    };
  })()`);
  await shoot("02_list_dark");

  // ── 5. 端到端：筛选条「新建 Preset」→ 对话框 → 创建成功 → 侧边栏出现该段（≥2 个才显示） ──
  report.createPresetFlow = await evaluate(`(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '新建 Preset');
    if (!btn) return { error: '筛选条没有新建入口' };
    btn.click();
    await wait(600);
    const nameInput = [...document.querySelectorAll('input')].find(i => (i.placeholder || '').includes('Preset 名称'));
    if (!nameInput) return { error: '对话框未出现' };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(nameInput, 'Verification');
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(300);
    const createBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '创建' && !b.disabled);
    if (!createBtn) return { error: '创建按钮不可用' };
    createBtn.click();
    await wait(1600);
    const side = document.querySelector('.w-\\\\[220px\\\\]');
    const sideButtons = [...side.querySelectorAll('button')].map(b => b.textContent.trim());
    return {
      对话框已关闭: !document.querySelector('input[placeholder*="Preset 名称"]'),
      侧栏重新出现Preset段: sideButtons.some(t => t.startsWith('Default')) && sideButtons.some(t => t.startsWith('Verification')),
      侧栏行: sideButtons.filter(t => t.startsWith('Default') || t.startsWith('Verification')),
    };
  })()`, true);

  // ── 6. 回归：token 是全局的，另两个视图各截一张确认没被改坏 ──
  await evaluate(`localStorage.setItem('theme','light')`);
  await goto(`http://127.0.0.1:${port}/settings`);
  await shoot("03_settings_light");
  await goto(`http://127.0.0.1:${port}/skill-activity`);
  await shoot("04_activity_light");

  fs.writeFileSync(path.join(evidence, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 1));
} catch (error) {
  console.error("诊断中断：", error.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* 忽略 */ }
  chrome?.kill();
  server.kill();
  await sleep(400);
  fs.rmSync(profile, { recursive: true, force: true });
  process.exit(process.exitCode ?? 0);
}
