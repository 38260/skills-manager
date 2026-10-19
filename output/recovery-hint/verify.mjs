// 验收：技能恢复面板里那句说明已删除，标题与空状态仍在（真实后端 + 无头 Chrome，隔离数据）。
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
const tag = process.argv[2] ?? "run";
const root = path.resolve("output/recovery-hint");
const dataRoot = path.join(root, "data", `run-${tag}-${Date.now()}`);
const home = path.join(dataRoot, "home");
const evidence = path.join(root, "evidence", tag);
fs.mkdirSync(evidence, { recursive: true });
const NODE = process.execPath;
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find(f => fs.existsSync(f));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const p = net.createServer(); p.listen(0, "127.0.0.1", () => { const { port } = p.address(); p.close(() => res(port)); }); p.on("error", rej); });
const failures = []; const results = [];
const record = (n, v) => { results.push({ n, v }); console.log(`· ${n}: ${JSON.stringify(v)}`); };
const expect = (n, ok, d) => { if (ok) record(n, d ?? "ok"); else { failures.push({ n, d }); record(n, { FAILED: d }); } };

const port = await freePort(); const dbg = await freePort();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "recovery-hint-"));
const server = spawn(NODE, ["backend/server.mjs", "--port", String(port), "--directory", path.join(home, ".skills-manager"), "--home", home], { stdio: "ignore", windowsHide: true });
for (let i = 0; i < 120; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch {} await sleep(150); }
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${dbg}`, "--remote-allow-origins=*", `--user-data-dir=${profile}`, "--window-size=1600,950", "about:blank"], { stdio: "ignore", windowsHide: true });
let ws; let target = null;
try {
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); target = l.find(t => t.type === "page"); } catch {} if (!target) await sleep(250); }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r, { once: true }));
  let seq = 0; const pend = new Map();
  ws.addEventListener("message", e => { const m = JSON.parse(e.data); const p = pend.get(m.id); if (p) { pend.delete(m.id); p(m.result); } });
  const send = (m, p) => new Promise(r => { const id = ++seq; pend.set(id, r); ws.send(JSON.stringify({ id, method: m, params: p ?? {} })); });
  const evalx = async ex => { const r = await send("Runtime.evaluate", { expression: ex, returnByValue: true }); if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text); return r?.result?.value; };
  const goto = async url => { await send("Page.navigate", { url }); await sleep(2600); };
  await send("Page.enable"); await send("Runtime.enable");
  await goto(`http://127.0.0.1:${port}/`);
  await evalx(`localStorage.setItem('theme','light');localStorage.setItem('language','zh')`);
  await goto(`http://127.0.0.1:${port}/my-skills`);
  // 空库会先弹「备份引导」，Esc 关掉再操作
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(600);
  // 空库会先弹「全新开始，还是从备份恢复？」引导，点「全新开始」关掉再操作
  const dismissed = await evalx(`(() => { const btn = [...document.querySelectorAll('button')].find(b => /全新开始|Start fresh/i.test(b.textContent)); btn?.click(); return !!btn; })()`);
  await sleep(900);
  record("已点「全新开始」关引导", dismissed);
  expect("引导弹窗可关闭", dismissed === true, dismissed);
  // 展开「技能恢复」（默认折叠）
  const openState = await evalx(`(() => { const btn = [...document.querySelectorAll('button[aria-controls="skill-recovery-list"]')][0]; if (!btn) return null; const before = btn.getAttribute('aria-expanded'); btn.click(); return before; })()`);
  await sleep(900);
  const after = await evalx(`(() => {
    const btn = document.querySelector('button[aria-controls="skill-recovery-list"]');
    const panel = document.getElementById('skill-recovery-list');
    return {
      title: btn ? btn.textContent.replace(/\\s+/g, ' ').trim().slice(0, 20) : null,
      expanded: btn ? btn.getAttribute('aria-expanded') : null,
      panelText: panel ? panel.textContent.replace(/\\s+/g, ' ').trim().slice(0, 120) : null,
      hasHint: panel ? panel.textContent.includes('恢复会保留当前版本') : null,
      hasEmpty: panel ? panel.textContent.includes('暂无技能快照') : null,
      paragraphs: panel ? panel.querySelectorAll('p').length : null,
    };
  })()`);
  record("展开前 aria-expanded", openState);
  record("展开后", after);
  expect("技能恢复入口仍在", after.title?.includes("技能恢复"), after.title);
  expect("面板已展开", after.expanded === "true", after.expanded);
  expect("说明句已删除", after.hasHint === false, after.hasHint);
  expect("空状态提示保留", after.hasEmpty === true, after.hasEmpty);
  const dialogGone = await evalx(`!document.body.innerText.includes('还是从备份恢复') && !document.body.innerText.includes('Start fresh, or restore')`);
  record("引导弹窗已关闭", dialogGone);
  expect("引导弹窗已关闭", dialogGone === true, dialogGone);
  // 展开技能恢复后再截图，能同时看到标题与空状态
  await evalx(`(() => { const btn = document.querySelector('button[aria-controls="skill-recovery-list"]'); if (btn?.getAttribute('aria-expanded') !== 'true') btn?.click(); return 1; })()`);
  await sleep(600);
  const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1600, height: 620, scale: 1 } });
  if (shot?.data) fs.writeFileSync(path.join(evidence, "01_my-skills-recovery.png"), Buffer.from(shot.data, "base64")); else console.error(["截图为空", JSON.stringify(shot)]);
  // 英文语言下也不再出现对应说明
  await evalx(`localStorage.setItem('language','en')`);
  await goto(`http://127.0.0.1:${port}/my-skills`);
  await evalx(`(() => { document.querySelector('button[aria-controls="skill-recovery-list"]')?.click(); return 1; })()`);
  await sleep(900);
  const en = await evalx(`(() => { const p = document.getElementById('skill-recovery-list'); return p ? p.textContent.slice(0, 120) : null; })()`);
  record("英文面板文本", en);
  expect("英文面板也不含该说明句", typeof en === "string" && !en.includes("Snapshots are saved before"), en);
} catch (error) {
  failures.push({ n: "脚本异常", d: String(error?.stack ?? error) });
  console.error(`✗ ${error?.message ?? error}`);
} finally {
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { server.kill(); } catch {}
}
fs.writeFileSync(path.join(evidence, "report.json"), JSON.stringify({ tag, at: new Date().toISOString(), failures, results }, null, 2));
if (failures.length) { console.error(`\n✗ ${failures.length} 项未通过`); process.exitCode = 1; }
else console.log(`\n✓ 全部 ${results.length} 项通过（证据：${evidence}）`);
