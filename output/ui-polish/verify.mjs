// 第六轮「UI / 交互细节修复」的界面级验收。
//
// 起真实后端（同时 serve dist/），无头 Chrome + CDP 打开页面，直接从 DOM 读断言。
//
// ⚠️ 安全边界：
//   1) 所有写操作命令在页面里被 fetch 拦截器直接拒绝（DENY 名单，并且**先拖 2.5s 再失败**，
//      这样才观察得到确认框的「执行中」状态）—— 后端收不到任何变更请求。
//      本轮改动涉及「删除本地 Skill / 拉取 / 来源克隆」，不拦就会动用户的真实技能库。
//   2) 拦截器用 Page.addScriptToEvaluateOnNewDocument 注入在任何页面脚本之前，规则放 localStorage，
//      切页与重载都持续生效。
//   3) 截图落在 output/ui-polish/shots/（已加进 .gitignore），里面会出现真实技能名与本机路径。
//
// 用法：npm run build && node output/ui-polish/verify.mjs
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = path.resolve(".");
const outDir = path.join(ROOT, "output/ui-polish/shots");
fs.mkdirSync(outDir, { recursive: true });

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(c => fs.existsSync(c));
if (!CHROME) throw new Error("找不到本机 Chrome / Edge");

const readJson = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const locales = [readJson("src/i18n/zh.json"), readJson("src/i18n/en.json"), readJson("src/i18n/zh-TW.json")];
/** 同一文案在三份语言包里各取一次：界面语言由用户设置决定，断言不该依赖它。 */
const labels = dotted => {
  const out = [];
  for (const table of locales) {
    let node = table;
    for (const part of dotted.split(".")) node = node?.[part];
    if (typeof node === "string" && !out.includes(node)) out.push(node);
  }
  return out;
};
/** 拼进页面表达式里的字符串数组（只做属性/文本等值比较，不拼进选择器）。 */
const jsArray = values => `[${values.map(value => JSON.stringify(String(value))).join(",")}]`;

/** 后端一律拒绝的写操作：验收期间不允许改动用户的真实数据。 */
const DENY = [
  "delete_managed_skill", "delete_managed_skills", "delete_global_local_skill",
  "import_global_local_skill_to_center", "update_global_local_skill_from_center",
  "install_local", "install_git", "confirm_git_install", "batch_import_folder",
  "set_skill_tool_toggle", "set_skill_tags", "delete_tag", "rename_tag",
  "scan_skill_activity", "cancel_skill_activity_scan", "configure_skill_activity_source",
  "create_skill_category", "set_tool_enabled", "set_all_tools_enabled",
];

// 页面侧工具：选择器逻辑集中一处，Node 侧只写断言。
const HELPERS = `(() => {
  if (window.__V) return;
  const visible = el => Boolean(el) && el.getClientRects().length > 0;
  const inList = (value, texts) => texts.includes((value || "").trim());
  window.__V = {
    calls: {},
    visible,
    byTitle: texts => [...document.querySelectorAll("button[title]")].find(b => inList(b.getAttribute("title"), texts) && visible(b)),
    byText: texts => [...document.querySelectorAll("button")].find(b => inList(b.textContent, texts) && visible(b)),
    bodyHas: texts => texts.some(text => document.body.innerText.includes(text)),
    cards: () => [...document.querySelectorAll(".app-panel")].filter(panel => panel.querySelector("h3 button")),
    actions: panel => [...panel.querySelectorAll("button[title]")].filter(b => !b.closest("h3") && visible(b)),
    dialog: () => [...document.querySelectorAll("div.fixed.inset-0")].find(el => el.querySelector("h2") && el.querySelectorAll("button").length >= 3 && visible(el)),
    sheet: () => document.querySelector('[role="dialog"][aria-modal="true"]'),
    rows: () => [...document.querySelectorAll("section button[aria-pressed]")].filter(visible),
    badgeIn: (scope, texts) => [...scope.querySelectorAll("span")].find(s => /py-px/.test(s.className) && inList(s.textContent, texts)),
    opacity: el => Number(getComputedStyle(el).opacity),
    bg: el => getComputedStyle(el).backgroundColor,
    listView: () => Boolean(document.querySelector('h3[class*="w-[180px]"]')),
    firstBadges: () => {
      const row = window.__V.rows()[0];
      const aside = document.querySelector("aside");
      if (!row || !aside) return null;
      return [...row.querySelectorAll("span")].filter(s => /py-px/.test(s.className))
        .map(cell => {
          const text = cell.textContent.trim();
          const badge = [...aside.querySelectorAll("span")].find(s => /py-px/.test(s.className) && s.textContent.trim() === text);
          return { text, rowBg: getComputedStyle(cell).backgroundColor, badgeBg: badge ? getComputedStyle(badge).backgroundColor : null, badgeClass: badge ? badge.className : null };
        });
    },
  };
  const config = () => { try { return JSON.parse(localStorage.getItem("sm-ui-polish") || "{}"); } catch { return {}; } };
  const failure = message => new Response(JSON.stringify({ ok: false, code: "io", message: message || "simulated failure" }),
    { status: 200, headers: { "content-type": "application/json" } });
  const commandOf = url => (url.match(/\\/api\\/invoke\\/([^?]+)/) || [])[1] || "";
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const mutate = (payload, spec) => {
    const items = payload?.data?.items;
    if (spec?.kind === "activityRecord" && Array.isArray(items) && items[0]) {
      if (spec.trigger) items[0].trigger = spec.trigger;
      if (spec.status) items[0].status = spec.status;
    }
    return payload;
  };
  window.__origFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const command = commandOf(typeof input === "string" ? input : input?.url || "");
    const cfg = config();
    if (command) window.__V.calls[command] = (window.__V.calls[command] || 0) + 1;
    const rule = (cfg.rules || []).find(item => item.command === command);
    if (rule?.delay) await wait(rule.delay);
    if (rule?.fail) return failure(cfg.message);
    if (command && (cfg.deny || []).includes(command)) { await wait(cfg.denyDelay || 2500); return failure(cfg.message); }
    if (rule?.mutate) {
      const response = await window.__origFetch(input, init);
      let payload = null;
      try { payload = await response.clone().json(); } catch { return response; }
      return new Response(JSON.stringify(mutate(payload, rule.mutate)),
        { status: 200, headers: { "content-type": "application/json" } });
    }
    return window.__origFetch(input, init);
  };
})();`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  probe.on("error", reject);
});

const port = await freePort();
const debugPort = await freePort();
const profile = fs.mkdtempSync(path.join(process.env.TEMP ?? "/tmp", "ui-polish-"));
const server = spawn(process.execPath, ["backend/server.mjs", "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = "";
server.stdout.on("data", chunk => { serverLog += chunk; });
server.stderr.on("data", chunk => { serverLog += chunk; });

const results = [];
const check = (label, ok, detail = "") => {
  results.push({ label, ok: Boolean(ok), detail: String(detail).slice(0, 400) });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? `  — ${String(detail).slice(0, 220)}` : ""}`);
};
const skip = (label, reason) => {
  results.push({ label, ok: null, detail: String(reason).slice(0, 400) });
  console.log(`- ${label}  跳过：${String(reason).slice(0, 220)}`);
};

let chrome, ws;
try {
  const deadline = Date.now() + 25000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* 等就绪 */ }
    if (Date.now() > deadline) throw new Error(`服务未就绪：${serverLog}`);
    await sleep(150);
  }

  chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--lang=zh-CN", `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*",
    `--user-data-dir=${profile}`, "--window-size=1600,1000"], { stdio: "ignore" });

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
    if (!entry) return;
    pending.delete(message.id);
    message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params ?? {} }));
  });
  const evaluate = async (expression, awaitPromise = false) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
    if (result.exceptionDetails) return { __error: result.exceptionDetails.exception?.description || result.exceptionDetails.text };
    return result.result?.value;
  };
  const shoot = async name => {
    const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1600, height: 1000, scale: 1 } });
    fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(shot.data, "base64"));
  };
  const setGuard = rules => evaluate(`localStorage.setItem("sm-ui-polish", ${
    JSON.stringify(JSON.stringify({ deny: DENY, denyDelay: 2600, message: "simulated failure (verify only)", rules }))}); 1`);
  const open = async (route, wait = 1500) => {
    await send("Page.navigate", { url: `http://127.0.0.1:${port}${route}` });
    await sleep(wait);
    // 无头窗口默认没有键盘焦点，不置前则 Input.dispatchKeyEvent 送不进页面。
    await send("Page.bringToFront");
  };
  const waitFor = async (expression, timeout = 12000, interval = 150) => {
    const end = Date.now() + timeout;
    for (;;) {
      const value = await evaluate(expression);
      if (value && value.__error === undefined) return value;
      if (Date.now() > end) return null;
      await sleep(interval);
    }
  };
  const press = async (key, code, vk, text) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(text ? { text } : {}) });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: HELPERS });

  const base = { coding: "/global-workspace", global: "/global-workspace", lobster: "/lobster-workspace" };
  const tools = await (await fetch(`http://127.0.0.1:${port}/api/invoke/get_tool_status`, {
    method: "POST", headers: { "content-type": "application/json", "x-skills-manager-client": "webview" }, body: "{}",
  })).json();
  const installed = (tools?.data ?? []).filter(tool => tool.installed && tool.enabled && !tool.hidden && base[tool.category]);
  if (installed.length === 0) throw new Error(`后端没有可验收的 Agent：${JSON.stringify(tools).slice(0, 200)}`);
  const routeOf = tool => `${base[tool.category] ?? base.global}/${tool.key}`;

  const DELETE_LABELS = jsArray(labels("globalWorkspace.localSkills.deleteLocal"));
  const PULL_LABELS = jsArray(labels("globalWorkspace.localSkills.pull"));
  const UPLOAD_LABELS = jsArray(labels("globalWorkspace.localSkills.upload"));
  const CANCEL_LABELS = jsArray(labels("common.cancel"));
  const CLOSE_LABELS = jsArray(labels("common.close"));
  const RUNNING_LABELS = jsArray(labels("common.running"));
  const RUNNING_HINT = jsArray(labels("common.runningLocked"));
  const REFRESH_LABELS = jsArray(labels("settings.refresh"));
  const REFRESHING_LABELS = jsArray(labels("globalWorkspace.localSkills.refreshing"));
  const RETRY_LABELS = jsArray(labels("common.retry"));
  const UPDATING_LABELS = jsArray(labels("activity.updating"));
  const TRIGGER_LABELS = ["manual", "automatic", "unknown"].flatMap(key => labels(`activity.triggers.${key}`));
  const TRIGGER_LABELS_JSON = jsArray(TRIGGER_LABELS);
  const MANUAL_LABELS = jsArray(labels("activity.triggers.manual"));

  // ══════════════════════ 先挑一个「有卡片、且有写操作按钮」的工作区 ══════════════════════
  // 遍历要等列表真的读完（旧写法固定 sleep 会撞上慢盘，误判成「这个 Agent 没有技能」）。
  let confirmTool = null, confirmKind = null, cardTool = null, bestCards = 0;
  const EMPTY_LABELS = jsArray(labels("globalWorkspace.localSkills.empty"));
  await setGuard([]);
  for (const tool of installed.slice(0, 10)) {
    await open(routeOf(tool), 500);
    const state = await waitFor(`(() => {
      const cards = document.querySelectorAll(".app-panel h3 button").length;
      const empty = ${EMPTY_LABELS}.some(text => document.body.innerText.includes(text));
      return cards > 0 || empty ? { cards, empty } : null;
    })()`, 9000);
    await sleep(1200);
    const kind = await evaluate(`(() => {
      if (__V.byTitle(${DELETE_LABELS})) return "delete";
      if (__V.byTitle(${PULL_LABELS})) return "pull";
      if (__V.byTitle(${UPLOAD_LABELS})) return "upload";
      return "";
    })()`);
    const url = await evaluate("location.pathname");
    console.log(`  · ${tool.key} 期望=${routeOf(tool)} 实际=${url} 卡片=${JSON.stringify(state)} 操作=${JSON.stringify(kind)}`);
    if (kind && !confirmTool) { confirmTool = tool; confirmKind = kind; }
    // 卡片最多的那个 Agent 用来测列表交互，避免撞上「恰好 0 个技能」的 Agent。
    if ((state?.cards ?? 0) > bestCards) { bestCards = state.cards; cardTool = tool; }
    if (confirmTool && bestCards >= 5) break;
  }
  if (!confirmTool) {
    skip("F1 确认框执行期锁住取消／关闭／遮罩", "前 10 个 Agent 工作区都没有「删除本地 Skill／拉取／上传」操作，无法在不动真实数据的前提下打开确认框");
  }
  // F4/F5/F6 只要求「列表里有卡片」，优先用卡片最多的那个 Agent；有操作按钮的 Agent 也一定有卡片。
  const workspaceTool = (bestCards >= 5 ? cardTool : null) ?? confirmTool ?? cardTool ?? installed[0];

  // ══════════════════════ F1 确认框：执行中锁住全部关闭入口 ══════════════════════
  if (!confirmKind) {
    /* 上面已记录跳过原因 */
  } else {
    await open(routeOf(confirmTool), 500);
    const TRIGGER_LOOKUP = `(__V.byTitle(${DELETE_LABELS}) || __V.byTitle(${PULL_LABELS}) || __V.byTitle(${UPLOAD_LABELS}))`;
    await waitFor(`(() => (${TRIGGER_LOOKUP}) ? 1 : null)()`, 9000);
    await evaluate(`(() => { (${TRIGGER_LOOKUP})?.click(); return 1; })()`);
    const panelUp = await waitFor(`Boolean(__V.dialog())`, 4000);
    // 点确认后要先把这一帧让出去：React 还没重渲染就点遮罩，用的仍是「未锁定」的旧闭包。
    const clicked = await evaluate(`(() => {
      const panel = __V.dialog(); if (!panel) return 0;
      const buttons = [...panel.querySelectorAll("button")];
      buttons[buttons.length - 1].click();
      return 1;
    })()`);
    await sleep(400);
    const locked = await evaluate(`(() => {
      const panel = __V.dialog();
      if (!panel) return { gone: true };
      const buttons = [...panel.querySelectorAll("button")];
      const cancel = buttons.find(b => ${CANCEL_LABELS}.includes(b.textContent.trim()));
      const close = buttons.find(b => ${CLOSE_LABELS}.includes(b.getAttribute("aria-label") || ""));
      panel.firstElementChild.click();          // 点遮罩想关掉：执行中应当无效（同一次求值里立刻验，避免等截图把在途时间耗掉）
      return {
        open: Boolean(__V.dialog()),
        cancelDisabled: cancel?.disabled === true,
        closeDisabled: close?.disabled === true,
        statusRole: Boolean(panel.querySelector('[role="status"]')),
        hint: ${RUNNING_HINT}.some(text => panel.innerText.includes(text)),
        confirmRunning: ${RUNNING_LABELS}.some(text => buttons[buttons.length - 1].textContent.includes(text)),
      };
    })()`);
    await shoot("f1-confirm-running");
    check("F1 执行中「取消」被禁用", Boolean(panelUp) && clicked === 1 && locked.cancelDisabled === true, JSON.stringify(locked));
    check("F1 执行中关闭(X)被禁用", locked.closeDisabled === true);
    check("F1 执行中有说明文案且带 role=status", locked.hint === true && locked.statusRole === true);
    check("F1 执行中确认按钮改读「执行中」", locked.confirmRunning === true);
    check("F1 执行中点遮罩不会关掉对话框", locked.open === true, JSON.stringify(locked));
    // 执行结束（成功或已报错）后不能卡在锁定态：要么自己收场，要么重新可取消。
    const settledState = await waitFor(`(() => {
      const panel = __V.dialog(); if (!panel) return "closed";
      const cancel = [...panel.querySelectorAll("button")].find(b => ${CANCEL_LABELS}.includes(b.textContent.trim()));
      return cancel && !cancel.disabled ? "cancellable" : null;
    })()`, 12000);
    const dismissed = await evaluate(`(() => {
      const panel = __V.dialog(); if (!panel) return "closed";
      [...panel.querySelectorAll("button")].find(b => ${CANCEL_LABELS}.includes(b.textContent.trim()))?.click();
      return __V.dialog() ? "still" : "closed";
    })()`);
    check("F1 执行结束后不卡在锁定态（能自己收场或重新可取消）",
      (settledState === "closed" || settledState === "cancellable") && dismissed === "closed", `${settledState}/${dismissed}`);
  }
  await setGuard([]);

  // ══════════════════════ F4 工作区：首屏骨架 / 刷新保留内容 ══════════════════════
  // (a) 骨架屏：让读盘慢 2.4s，看首屏给的是骨架而不是一行字或空白。
  await setGuard([{ command: "get_global_local_skills", delay: 2400 }]);
  await open(routeOf(workspaceTool), 300);
  const pulseSeen = await waitFor(`document.querySelectorAll(".animate-pulse").length ? 1 : null`, 6000);
  const skeleton = await evaluate(`(() => ({
    pulse: document.querySelectorAll(".animate-pulse").length,
    titles: document.querySelectorAll(".app-panel h3 button").length,
  }))()`);
  if (!pulseSeen) skip("F4 首屏是骨架屏", "没等到骨架屏（该 Agent 读盘太快或列表本来为空）");
  else check("F4 首屏是骨架屏（不是一行“加载中”，也不是空白）", skeleton.pulse > 0 && skeleton.titles === 0, JSON.stringify(skeleton));
  await shoot("f4-workspace-skeleton");

  // (b) 刷新保留内容：重新用「无延迟」载入，避免 (a) 留下的挂起请求把基线测成 0。
  await setGuard([]);
  await open(routeOf(workspaceTool), 1200);
  const settled = await waitFor(`document.querySelectorAll(".app-panel h3 button").length || null`, 15000);
  if (!settled) {
    skip("F4 刷新时保留列表内容", `载入后没读到卡片（route=${routeOf(workspaceTool)}）`);
  } else {
    await setGuard([{ command: "get_global_local_skills", delay: 2400 }]);
    await evaluate(`(() => { __V.byTitle(${REFRESH_LABELS})?.click(); return 1; })()`);
    await sleep(600);
    const during = await evaluate(`(() => ({
      titles: document.querySelectorAll(".app-panel h3 button").length,
      hint: __V.bodyHas(${REFRESHING_LABELS}),
      busy: Boolean(document.querySelector('[aria-busy="true"]')),
      skeleton: document.querySelectorAll(".animate-pulse").length,
    }))()`);
    await shoot("f4-workspace-refreshing");
    check("F4 刷新时列表内容没有被清空", during.titles === settled, JSON.stringify({ settled, ...during }));
    check("F4 刷新时给局部进度文案", during.hint === true, JSON.stringify(during));
    check("F4 刷新容器标 aria-busy", during.busy === true);
    check("F4 同 Agent 刷新不回退成骨架屏", during.skeleton === 0);
    await waitFor(`document.querySelectorAll('[aria-busy="true"]').length === 0 ? 1 : 0`, 12000);
  }

  // ══════════════════════ F5 卡片键盘可达（列表视图才有悬停显形）══════════════════════
  // 重新做一次「无人为延迟」的导航：F4 的骨架测试会留下一个 2.4s 的挂起请求，
  // 不能让它把后面的键盘／弹层断言一起拖成假失败。
  await setGuard([]);
  await open(routeOf(workspaceTool), 1200);
  const ready = await waitFor(`document.querySelectorAll(".app-panel h3 button").length || null`, 15000);
  const switched = await evaluate(`(() => {
    const toggle = [...document.querySelectorAll("button")].find(b => b.querySelector("svg.lucide-list:not([class*=tree])") && __V.visible(b));
    toggle?.click();
    return Boolean(toggle);
  })()`);
  await sleep(700);
  const isList = await evaluate(`__V.listView()`);
  if (!switched || !isList) skip("F5 行内操作在键盘聚焦时显形", `没能切到列表视图（toggle=${switched} listView=${isList}）`);

  const focusable = await evaluate(`(() => {
    document.activeElement?.blur?.();
    const button = document.querySelector(".app-panel h3 button");
    if (!button) return { missing: true };
    button.focus();
    return { focused: document.activeElement === button, tag: document.activeElement.tagName, name: button.textContent.trim(), hasFocus: document.hasFocus() };
  })()`);
  check("F5 卡片标题是可键盘聚焦的按钮（不再是裸 div）", focusable.focused === true && focusable.tag === "BUTTON", JSON.stringify(focusable));
  await press("Enter", "Enter", 13, "\r");
  const sheetUp = await waitFor(`Boolean(__V.sheet())`, 4000);
  check("F5 回车即可打开技能详情", sheetUp === true, JSON.stringify(focusable));

  // ══════════════════════ F6 DetailSheet 焦点管理与 Esc ══════════════════════
  if (!sheetUp) {
    skip("F6 弹层焦点管理与 Esc 关闭", "上一步没能打开弹层");
  } else {
    const focus = await evaluate(`(() => {
      const sheet = __V.sheet();
      const heading = sheet.querySelector("h2");
      return {
        onSheet: document.activeElement === sheet,
        labelledBy: Boolean(heading) && sheet.getAttribute("aria-labelledby") === heading.id,
        closeNamed: [...sheet.querySelectorAll("button")].some(b => ${CLOSE_LABELS}.includes(b.getAttribute("aria-label") || "")),
      };
    })()`);
    check("F6 打开弹层后焦点移入弹层本身", focus.onSheet === true, JSON.stringify(focus));
    check("F6 弹层用 aria-labelledby 指向标题", focus.labelledBy === true);
    check("F6 关闭按钮有可读名称", focus.closeNamed === true);
    const seeded = await evaluate(`(() => {
      const sheet = __V.sheet();
      const items = [...sheet.querySelectorAll("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")].filter(el => el.getClientRects().length > 0);
      if (items.length < 2) return { tooFew: items.length };
      items[items.length - 1].focus();
      return { count: items.length };
    })()`);
    if (seeded?.tooFew !== undefined) skip("F6 Tab 焦点圈在弹层内", `弹层内只有 ${seeded.tooFew} 个可聚焦元素`);
    else {
      await press("Tab", "Tab", 9);
      const kept = await evaluate(`(() => { const sheet = __V.sheet(); return sheet ? sheet.contains(document.activeElement) : false; })()`);
      check("F6 Tab 到末尾不会跑进被弹层遮住的内容", kept === true, JSON.stringify(seeded));
    }
    await shoot("f6-detail-sheet");
    await press("Escape", "Escape", 27);
    await sleep(700);
    const closed = await evaluate(`(() => ({
      gone: !__V.sheet(),
      backOnCard: document.activeElement === document.querySelector(".app-panel h3 button"),
    }))()`);
    check("F6 Esc 关闭弹层", closed.gone === true, JSON.stringify(closed));
    check("F6 关闭后焦点回到打开它的卡片标题", closed.backOnCard === true, JSON.stringify(closed));
  }

  // ══════════════════════ F5 行内操作的非悬停兜底（要在弹层关掉之后再量，否则聚焦的是弹层）══════════════════════
  if (isList) {
    const revealStart = await evaluate(`(() => {
      document.activeElement?.blur?.();
      const panel = __V.cards().find(card => __V.actions(card).length > 0);
      if (!panel) return { missing: true };
      window.__revealGroup = __V.actions(panel)[0].closest("div");
      const before = __V.opacity(window.__revealGroup);
      __V.actions(panel)[0].focus();
      return { before, focused: document.activeElement === __V.actions(panel)[0], label: __V.actions(panel)[0].getAttribute("title") };
    })()`);
    // 显形带 transition-opacity（150ms），立刻取 computed style 会读到动画中间值。
    await sleep(400);
    const revealAfter = await evaluate(`window.__revealGroup ? __V.opacity(window.__revealGroup) : null`);
    if (revealStart.missing) skip("F5 行内操作在键盘聚焦时显形", "该工作区所有卡片都与中心库一致，没有行内操作按钮");
    else check("F5 行内操作在键盘聚焦时显形", revealStart.before === 0 && revealStart.focused === true && revealAfter === 1, JSON.stringify({ ...revealStart, after: revealAfter }));

    // 触屏兜底：headless 的 hover 媒体模拟不生效（实测 matchMedia('(hover: none)') 始终 false），
    // 所以直接查样式表里那条 @media(hover:none) 规则是否命中这个元素、并把 opacity 设为 1。
    const touch = await evaluate(`(() => {
      document.activeElement?.blur?.();
      const panel = __V.cards().find(card => __V.actions(card).length > 0);
      if (!panel) return { missing: true };
      const group = __V.actions(panel)[0].closest("div");
      const hits = [];
      for (const sheet of document.styleSheets) {
        let rules = null;
        try { rules = sheet.cssRules; } catch { continue; }
        for (const rule of rules) {
          if (rule.constructor.name !== "CSSMediaRule") continue;
          if (!/hover:\\s*none/.test(rule.conditionText || "")) continue;
          for (const inner of rule.cssRules) {
            if (!inner.selectorText) continue;
            try { if (group.matches(inner.selectorText) && inner.style.opacity === "1") hits.push(inner.selectorText); } catch { /* 非法选择器忽略 */ }
          }
        }
      }
      return { hit: hits.length > 0, hits: hits.slice(0, 2), cls: group.className };
    })()`);
    if (touch.missing) skip("F5 触屏（无 hover 能力）下操作直接可见", "没有行内操作按钮可测");
    else check("F5 触屏（无 hover 能力）下操作直接可见", touch.hit === true, JSON.stringify(touch));
  }

  // ══════════════════════ 调用记录：F2 跟随最新 / F4 查询反馈 / F7 徽章配色 ══════════════════════
  await setGuard([]);
  await open("/skill-activity", 6500);
  const rowCount = await evaluate(`__V.rows().length`);
  if (!rowCount) {
    skip("F2 详情栏跟随最新记录", "调用记录为空（本机还没采集到记录）");
    skip("F4 调用记录再查询保留旧结果", "调用记录为空");
    skip("F7 详情徽章配色与列表一致", "调用记录为空");
  } else {
    const tones = await evaluate(`__V.firstBadges()`);
    const triggerTones = (tones ?? []).filter(item => TRIGGER_LABELS.includes(item.text) && item.badgeBg);
    check("F7 详情徽章与列表徽章同色（复用 activityTone）",
      triggerTones.some(item => item.badgeBg === item.rowBg), JSON.stringify(tones));
    check("F7 详情徽章不再统一绿底", triggerTones.some(item => /bg-sky-|bg-surface-hover|bg-accent-bg/.test(item.badgeClass || "")), JSON.stringify(triggerTones));

    await evaluate(`__V.rows()[0].click(); 1`);
    await sleep(400);
    const before = await evaluate(`(() => {
      const row = document.querySelector('section button[aria-pressed="true"]');
      const aside = document.querySelector("aside");
      const badge = __V.badgeIn(aside, ${TRIGGER_LABELS_JSON});
      return { pressed: row?.getAttribute("aria-label") || null, trigger: badge?.textContent.trim() || null };
    })()`);
    await setGuard([{ command: "get_skill_activity", mutate: { kind: "activityRecord", trigger: "manual" } }]);
    const flipped = await waitFor(`(() => {
      const aside = document.querySelector("aside");
      const badge = __V.badgeIn(aside, ${MANUAL_LABELS});
      return badge ? badge.textContent.trim() : null;
    })()`, 32000);
    const sameSelection = await evaluate(`(() => {
      const row = document.querySelector('section button[aria-pressed="true"]');
      return row ? row.getAttribute("aria-label") : null;
    })()`);
    check("F2 刷新后详情显示最新内容（不再抱着旧对象）", MANUAL_LABELS.includes(flipped) && flipped !== before.trigger, JSON.stringify({ before, flipped }));
    check("F2 刷新后选中项没有跳走", sameSelection === before.pressed, JSON.stringify({ before: before.pressed, now: sameSelection }));

    await setGuard([{ command: "get_skill_activity", delay: 2000, mutate: { kind: "activityRecord", trigger: "manual" } }]);
    await evaluate(`(() => {
      const input = document.querySelector("form input");
      const form = input?.closest("form");
      if (!form) return 0;
      input.focus();
      form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      return 1;
    })()`);
    await sleep(600);
    const querying = await evaluate(`(() => ({
      rows: __V.rows().length,
      hint: __V.bodyHas(${UPDATING_LABELS}),
      busy: Boolean(document.querySelector('[aria-busy="true"]')),
    }))()`);
    await shoot("f4-activity-querying");
    check("F4 再查询时旧结果没有被抹掉", querying.rows > 0, JSON.stringify(querying));
    check("F4 再查询时给出「正在更新结果」反馈", querying.hint === true && querying.busy === true, JSON.stringify(querying));
  }

  // ══════════════════════ F3 技能详情：来源读取失败可见 + 可重试 ══════════════════════
  // 失败规则必须在「第一次点进来源页签」之前就装好：成功过的版本会被复用，
  // 先成功再装失败规则是测不到失败态的（这正是 F3 想要的行为）。
  await setGuard([{ command: "get_source_skill_document", fail: true }, { command: "get_skill_source_diff", fail: true }]);
  await open("/my-skills", 4500);
  const detailUp = await waitFor(`(() => {
    const card = document.querySelector(".app-panel h3") || document.querySelector(".app-panel");
    (card?.querySelector("button") || card)?.click();
    return Boolean(document.querySelector(".skill-detail-main"));
  })()`, 6000);
  const sourceTabLabel = await waitFor(`(() => {
    const button = ${jsArray(labels("mySkills.detail.tabSourceDiff"))}.map(text => __V.byText([text])).find(Boolean);
    button?.click();
    return button ? button.textContent.trim() : null;
  })()`, 6000);
  if (!detailUp || !sourceTabLabel) {
    skip("F3 来源读取失败给出原因与重试", `打不开技能详情或没有「来源与差异」页签（detail=${detailUp} tab=${sourceTabLabel}）`);
  } else {
    await sleep(2000);
    const failed = await evaluate(`(() => {
      const alerts = [...document.querySelectorAll('[role="alert"]')].filter(el => /simulated failure/.test(el.textContent) && __V.visible(el));
      const retries = [...document.querySelectorAll("button")].filter(b => ${RETRY_LABELS}.includes(b.textContent.trim()) && __V.visible(b));
      return {
        alerts: alerts.length, retries: retries.length, sample: alerts[0]?.textContent.trim(),
        allAlerts: [...document.querySelectorAll('[role="alert"]')].map(a => a.textContent.trim().slice(0, 50)),
        mainText: document.querySelector(".skill-detail-main")?.innerText.slice(0, 160).replace(/\\n/g, " | "),
        calls: window.__V.calls,
      };
    })()`);
    console.log("  · F3 现场:", JSON.stringify(failed));
    await shoot("f3-source-failed");
    check("F3 来源读取失败显示后端原因", failed.alerts >= 1, JSON.stringify(failed));
    check("F3 失败处有「重试」入口", failed.retries >= 1, JSON.stringify(failed));

    // 「切页签会重读」：失败不留复用标记，所以切走再切回应当再发一次请求。
    const callsBefore = await evaluate(`window.__V.calls.get_source_skill_document || 0`);
    await evaluate(`(() => { __V.byText(${jsArray(labels("mySkills.detail.tabDoc"))})?.click(); return 1; })()`);
    await sleep(400);
    await evaluate(`(() => { __V.byText([${JSON.stringify(sourceTabLabel)}])?.click(); return 1; })()`);
    await sleep(1200);
    const callsAfter = await evaluate(`window.__V.calls.get_source_skill_document || 0`);
    check("F3 失败后切走再切回本页签会自动重读", callsAfter > callsBefore, `${callsBefore} → ${callsAfter}`);

    if (failed.retries >= 1) {
      await setGuard([]);
      await evaluate(`(() => {
        [...document.querySelectorAll("button")].filter(b => ${RETRY_LABELS}.includes(b.textContent.trim()) && __V.visible(b))[0]?.click();
        return 1;
      })()`);
      const cleared = await waitFor(`[...document.querySelectorAll('[role="alert"]')].filter(el => /simulated failure/.test(el.textContent)).length === 0 ? 1 : null`, 25000);
      check("F3 点重试后重新读取（失败态被清掉）", Boolean(cleared), JSON.stringify(failed));
    }
  }

  const failedChecks = results.filter(item => item.ok === false);
  const skipped = results.filter(item => item.ok === null);
  console.log(`\n通过 ${results.length - failedChecks.length - skipped.length} / 失败 ${failedChecks.length} / 跳过 ${skipped.length}`);
  fs.writeFileSync(path.join(ROOT, "output/ui-polish/result.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  process.exitCode = failedChecks.length ? 1 : 0;
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  try { chrome?.kill(); } catch { /* ignore */ }
  try { server.kill(); } catch { /* ignore */ }
  await sleep(300);
}
