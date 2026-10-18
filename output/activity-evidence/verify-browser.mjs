async page => {
  const results = [];
  const check = (name, ok) => { results.push({ name, ok }); if (!ok) throw new Error(name); };
  const panel = page.locator("aside").first();
  const rows = page.locator('div[role="button"][aria-pressed]');
  const current = () => page.locator('div[role="button"][aria-pressed="true"]');
  const capture = () => page.evaluate(() => ({
    url: location.href,
    scroll: document.getElementById("page-scroll-container").scrollTop,
    filter: document.querySelector('input[aria-label="技能"]').value,
    selected: document.querySelector('div[role="button"][aria-pressed="true"]').textContent,
    footer: document.querySelector('section[aria-label="调用记录列表"] footer').textContent,
  }));
  await page.setViewportSize({ width: 1778, height: 1100 });
  await page.evaluate(() => localStorage.setItem("theme", "dark"));
  await page.goto("http://127.0.0.1:14318/skill-activity");
  await page.locator("#boot-splash").waitFor({ state: "hidden" });
  await panel.getByText("session-0.jsonl · 第 2 行", { exact: true }).waitFor();
  await rows.first().getByRole("button", { name: /打开技能详情/ }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "返回调用记录", exact: true }).click();
  check("技能名打开真实技能详情后原路返回", await page.getByRole("dialog").count() === 0 && page.url().endsWith("/skill-activity"));

  await page.getByRole("textbox", { name: "技能", exact: true }).fill("ponytail");
  await page.getByRole("combobox", { name: "工具", exact: true }).selectOption("codex");
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await page.getByText("第 1 / 2 页", { exact: true }).waitFor();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await page.getByText("第 2 / 2 页", { exact: true }).waitFor();
  await rows.nth(1).click();
  const link = current().getByRole("button", { name: /打开技能详情/ });
  await link.scrollIntoViewIfNeeded();
  await link.focus();
  const before = await capture();
  await link.click();
  await page.getByRole("dialog").waitFor();
  check("点击技能名不改变当前选中记录或路由", (await capture()).selected === before.selected && page.url() === before.url);
  await page.getByRole("button", { name: "返回调用记录", exact: true }).click();
  const after = await capture();
  check("返回保留搜索、工具筛选、第二页、选中项和滚动", JSON.stringify(before) === JSON.stringify(after));
  check("返回后焦点回到技能链接", await link.evaluate(element => document.activeElement === element));
  await link.press("Enter");
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  check("Enter 打开详情、Esc 返回并恢复焦点", await page.getByRole("dialog").count() === 0 && await link.evaluate(element => document.activeElement === element));

  await page.getByRole("textbox", { name: "技能", exact: true }).fill("");
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await page.getByText("第 1 / 3 页", { exact: true }).waitFor();
  await rows.first().click();
  await panel.getByText("session-0.jsonl · 第 2 行", { exact: true }).waitFor();
  const card = panel.getByTestId("activity-evidence");
  check("4000 字符之后的命中命令仍然可见", (await card.locator("pre").first().textContent()).includes("ponytail/SKILL.md"));
  check("技能路径有局部高亮，原文和上下文默认折叠", await card.locator("mark").count() > 0 && await card.locator("details[open]").count() === 0);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await panel.getByRole("button", { name: "复制命中内容" }).click();
  check("复制得到解码后的命令", (await page.evaluate(() => navigator.clipboard.readText())).includes("Get-Content"));
  await panel.getByText("查看上下文", { exact: true }).click();
  check("上下文展示真实的用户、调用、返回与原始行号", await card.getByText("用户消息", { exact: true }).isVisible() && await card.getByText("工具返回", { exact: true }).isVisible());
  await panel.getByText("查看原始记录", { exact: true }).click();
  check("原始记录展开并明确原文截断", await card.getByText("片段过长，已截断显示。", { exact: true }).isVisible());
  await rows.nth(1).click();
  await panel.getByText("session-1.jsonl · 第 2 行", { exact: true }).waitFor();
  check("切换记录清除旧的证据和展开状态", await panel.locator("details[open]").count() === 0 && (await panel.getByTestId("activity-evidence").locator("pre").first().textContent()).includes("computer-use/SKILL.md"));
  await rows.nth(2).click();
  await panel.getByText("未识别日志结构，以下显示原文。", { exact: true }).waitFor();
  check("损坏记录有明确原文回退", (await panel.textContent()).includes("{broken-json"));

  await page.getByRole("textbox", { name: "技能", exact: true }).fill("unmanaged-skill");
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await panel.getByText("来源文件已不存在或已被移动。", { exact: true }).waitFor();
  check("缺失日志提示准确，未关联技能没有虚假跳转", await rows.getByRole("button", { name: /打开技能详情/ }).count() === 0);

  await page.getByRole("textbox", { name: "技能", exact: true }).fill("");
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await page.getByText("第 1 / 3 页", { exact: true }).waitFor();
  await rows.first().click();
  await panel.getByText("session-0.jsonl · 第 2 行", { exact: true }).waitFor();
  await page.evaluate(() => document.getElementById("page-scroll-container").scrollTop = 315);
  await page.screenshot({ path: "output/playwright/activity-evidence-dark.png" });
  await page.evaluate(() => localStorage.setItem("theme", "light"));
  await page.reload();
  await page.locator("#boot-splash").waitFor({ state: "hidden" });
  await panel.getByText("session-0.jsonl · 第 2 行", { exact: true }).waitFor();
  await page.evaluate(() => document.getElementById("page-scroll-container").scrollTop = 315);
  await page.screenshot({ path: "output/playwright/activity-evidence-light.png" });
  await panel.getByText("查看上下文", { exact: true }).click();
  await page.screenshot({ path: "output/playwright/activity-evidence-context.png" });
  await page.setViewportSize({ width: 1000, height: 900 });
  await rows.nth(1).click();
  await panel.getByText("session-1.jsonl · 第 2 行", { exact: true }).waitFor();
  check("窄窗口无横向溢出", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.getElementById("page-scroll-container").scrollWidth <= document.getElementById("page-scroll-container").clientWidth));
  await page.waitForFunction(() => {
    const bounds = document.querySelector('[data-testid="activity-evidence"]').getBoundingClientRect();
    return bounds.top < innerHeight - 180 && bounds.bottom > 28;
  });
  check("窄窗口选中记录后详情进入视野", true);
  await page.screenshot({ path: "output/playwright/activity-evidence-narrow.png" });
  return results;
}
