const { chromium } = require("C:/Users/Leo Tang/.workbuddy/binaries/node/workspace/node_modules/playwright-core");
const EXE = "C:/Users/Leo Tang/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe";

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.setDefaultTimeout(8000);

  await page.goto("http://localhost:8080/index.html", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForFunction(() => document.body.innerText.includes("已加载"), { timeout: 15000 });
  await page.screenshot({ path: "scripts/shot_overview.png", fullPage: true });
  console.log("OVERVIEW OK; bodyText len=", (await page.textContent("body")).length);

  const clickTab = async (name) => {
    const btn = page.locator("nav.tabs button", { hasText: name });
    console.log("tab", name, "count=", await btn.count());
    await btn.first().click();
    await page.waitForTimeout(400);
  };

  await clickTab("统计分析");
  console.log("after stats tab, body snippet:", (await page.textContent("body")).replace(/\s+/g, " ").slice(0, 200));
  await page.screenshot({ path: "scripts/shot_stats.png", fullPage: true });

  const runBtn = page.locator("button", { hasText: "计算统计" });
  console.log("计算统计 btn count=", await runBtn.count());
  if (await runBtn.count()) { await runBtn.first().click(); await page.waitForTimeout(800); }
  await page.screenshot({ path: "scripts/shot_stats2.png", fullPage: true });

  await clickTab("回测评估");
  const btBtn = page.locator("button", { hasText: "运行回测" });
  console.log("运行回测 btn count=", await btBtn.count());
  if (await btBtn.count()) { await btBtn.first().click(); await page.waitForTimeout(1200); }
  await page.screenshot({ path: "scripts/shot_backtest.png", fullPage: true });

  await clickTab("策略对比");
  const cmpBtn = page.locator("button", { hasText: "运行对比" });
  if (await cmpBtn.count()) { await cmpBtn.first().click(); await page.waitForTimeout(1000); }
  await page.screenshot({ path: "scripts/shot_compare.png", fullPage: true });

  console.log("ERRORS:", errors.length ? errors.join("\n") : "none");
  await browser.close();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
