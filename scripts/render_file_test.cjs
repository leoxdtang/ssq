const { chromium } = require("C:/Users/Leo Tang/.workbuddy/binaries/node/workspace/node_modules/playwright-core");
const EXE = "C:/Users/Leo Tang/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe";
const URL = "file:///D:/AI项目空间/workbuddy_tmp/双色球/index.html";

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ["--no-sandbox", "--disable-gpu", "--allow-file-access-from-files"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.setDefaultTimeout(10000);

  await page.goto(URL, { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() => document.body.innerText.includes("已加载"), { timeout: 15000 });
  const body = (await page.textContent("body")).replace(/\s+/g, " ");
  console.log("FILE:// OVERVIEW OK; 含'2477'=", body.includes("2477"), "; 片段:", body.slice(0, 160));
  await page.screenshot({ path: "scripts/shot_file_overview.png", fullPage: true });

  const clickTab = async (name) => {
    const btn = page.locator("nav.tabs button", { hasText: name });
    if (await btn.count()) { await btn.first().click(); await page.waitForTimeout(400); }
  };

  await clickTab("统计分析");
  const calc = page.locator("button", { hasText: "计算统计" });
  if (await calc.count()) { await calc.first().click(); await page.waitForTimeout(900); }
  console.log("STATS ran; 片段:", (await page.textContent("body")).replace(/\s+/g, " ").slice(0, 140));

  await clickTab("回测评估");
  const bt = page.locator("button", { hasText: "运行回测" });
  if (await bt.count()) { await bt.first().click(); await page.waitForTimeout(1300); }
  const btText = (await page.textContent("body")).replace(/\s+/g, " ");
  console.log("BACKTEST ran; 含'ROI'=", btText.includes("ROI"), "; 片段:", btText.slice(0, 160));

  console.log("ERRORS:", errors.length ? errors.join(" | ") : "none");
  await browser.close();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
