import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";

type Platform = "weblancer" | "freelancehunt" | "freelancer";

type QueueItem = {
  id: string;
  platform: Platform;
  title: string;
  link: string;
  bidText: string;
  bidAmount?: number;
  deliveryDays?: number;
};

type CliOptions = {
  checkOnly: boolean;
  submit: boolean;
  manualLogin: boolean;
  platform: Platform | "all";
  limit?: number;
  queuePath: string;
  headed: boolean;
};

const backendDir = process.cwd();
const rootDir = path.resolve(backendDir, "..");
const salesDir = path.resolve(rootDir, "sales");
const logsDir = path.resolve(salesDir, "logs", "freelance-bid-bot");

const loginUrls: Record<Platform, string> = {
  weblancer: "https://www.weblancer.net/users/login/",
  freelancehunt: "https://freelancehunt.com/login",
  freelancer: "https://www.freelancer.com/login",
};

const loadEnv = () => {
  const candidates = [
    path.resolve(rootDir, ".env"),
    path.resolve(backendDir, ".env"),
    path.resolve(rootDir, ".env.freelance"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate, override: false });
    }
  }
};

const ensureDir = (targetPath: string) => {
  fs.mkdirSync(targetPath, { recursive: true });
};

const nowStamp = () => {
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    checkOnly: false,
    submit: false,
    manualLogin: false,
    platform: "all",
    queuePath: path.resolve(salesDir, "freelance-bids-queue-2026-05-22.json"),
    headed: (process.env.FREELANCE_HEADLESS ?? "false").toLowerCase() !== "true",
  };

  for (const arg of argv) {
    if (arg === "--check") {
      options.checkOnly = true;
      continue;
    }

    if (arg === "--submit") {
      options.submit = true;
      continue;
    }

    if (arg === "--manual-login") {
      options.manualLogin = true;
      continue;
    }

    if (arg === "--headless") {
      options.headed = false;
      continue;
    }

    if (arg.startsWith("--platform=")) {
      const value = arg.slice("--platform=".length).trim().toLowerCase();
      if (value === "all" || value === "weblancer" || value === "freelancehunt" || value === "freelancer") {
        options.platform = value;
      }
      continue;
    }

    if (arg.startsWith("--limit=")) {
      const value = Number(arg.slice("--limit=".length));
      if (Number.isInteger(value) && value > 0) {
        options.limit = value;
      }
      continue;
    }

    if (arg.startsWith("--queue=")) {
      const raw = arg.slice("--queue=".length).trim();
      if (raw) {
        options.queuePath = path.isAbsolute(raw) ? raw : path.resolve(backendDir, raw);
      }
    }
  }

  return options;
};

const readQueue = (queuePath: string) => {
  if (!fs.existsSync(queuePath)) {
    throw new Error(`Queue file not found: ${queuePath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(queuePath, "utf8")) as QueueItem[];
  return parsed;
};

const getCredentialKeys = (platform: Platform) => {
  if (platform === "weblancer") {
    return { email: "WEBLANCER_EMAIL", password: "WEBLANCER_PASSWORD" } as const;
  }

  if (platform === "freelancehunt") {
    return { email: "FREELANCEHUNT_EMAIL", password: "FREELANCEHUNT_PASSWORD" } as const;
  }

  return { email: "FREELANCER_EMAIL", password: "FREELANCER_PASSWORD" } as const;
};

const getCredentials = (platform: Platform) => {
  const keys = getCredentialKeys(platform);
  return {
    email: process.env[keys.email]?.trim() || "",
    password: process.env[keys.password]?.trim() || "",
  };
};

const saveScreenshot = async (page: Page, prefix: string) => {
  ensureDir(logsDir);
  const targetPath = path.resolve(logsDir, `${nowStamp()}-${prefix}.png`);
  await page.screenshot({ path: targetPath, fullPage: true });
  return targetPath;
};

const findVisibleLocator = async (page: Page, selectors: string[]) => {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) {
        return candidate;
      }
    }
  }

  return null;
};

const clickByText = async (page: Page, texts: string[]) => {
  for (const text of texts) {
    const locator = page.getByText(text, { exact: false });
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) {
        await candidate.click({ timeout: 5000 }).catch(() => undefined);
        return true;
      }
    }
  }

  return false;
};

const fillLocator = async (locator: Locator, value: string) => {
  const tagName = await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => "");
  if (tagName === "textarea" || tagName === "input") {
    await locator.fill(value);
    return;
  }

  await locator.click();
  await locator.evaluate((element, text) => {
    element.textContent = text;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
};

const isProbablyLoggedIn = async (page: Page) => {
  const selectors = [
    "a[href*='logout']",
    "button:has-text('Logout')",
    "button:has-text('Log out')",
    "[data-testid='user-menu']",
    ".userpic",
    ".header-user",
    ".dropdown-user",
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    if (count > 0) {
      const candidate = locator.first();
      if (await candidate.isVisible().catch(() => false)) {
        return true;
      }
    }
  }

  return false;
};

const loginPlatform = async (context: BrowserContext, platform: Platform) => {
  const credentials = getCredentials(platform);
  const page = await context.newPage();
  await page.goto(loginUrls[platform], { waitUntil: "domcontentloaded" });

  if (await isProbablyLoggedIn(page)) {
    return page;
  }

  if (!credentials.email || !credentials.password) {
    throw new Error(`Missing credentials for ${platform}. Fill .env.freelance first or use --manual-login.`);
  }

  const emailField = await findVisibleLocator(page, [
    "input[type='email']",
    "input[name*='email']",
    "input[name*='login']",
    "input[name*='user']",
    "input[id*='email']",
    "input[id*='login']",
  ]);

  const passwordField = await findVisibleLocator(page, [
    "input[type='password']",
    "input[name*='password']",
    "input[id*='password']",
  ]);

  if (!emailField || !passwordField) {
    const screenshotPath = await saveScreenshot(page, `${platform}-login-form-missing`);
    throw new Error(`Could not find login form for ${platform}. Screenshot: ${screenshotPath}`);
  }

  await emailField.fill(credentials.email);
  await passwordField.fill(credentials.password);

  const submitButton = await findVisibleLocator(page, [
    "button[type='submit']",
    "input[type='submit']",
    "button",
  ]);

  if (!submitButton) {
    const screenshotPath = await saveScreenshot(page, `${platform}-login-submit-missing`);
    throw new Error(`Could not find submit button for ${platform}. Screenshot: ${screenshotPath}`);
  }

  await submitButton.click().catch(() => undefined);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(5000);

  if (await isProbablyLoggedIn(page)) {
    return page;
  }

  const screenshotPath = await saveScreenshot(page, `${platform}-login-post-submit`);
  throw new Error(
    `Login for ${platform} was not confirmed automatically. If 2FA is enabled, finish it manually in the opened browser, then rerun. Screenshot: ${screenshotPath}`
  );
};

const waitForManualLogin = async (context: BrowserContext, platform: Platform) => {
  const page = await context.newPage();
  await page.goto(loginUrls[platform], { waitUntil: "domcontentloaded" });
  console.log(`Manual login required for ${platform}. Complete registration/login in the opened browser window.`);

  const timeoutAt = Date.now() + 10 * 60 * 1000;
  while (Date.now() < timeoutAt) {
    if (await isProbablyLoggedIn(page)) {
      console.log(`Manual login confirmed for ${platform}.`);
      return page;
    }

    await page.waitForTimeout(3000);
  }

  const screenshotPath = await saveScreenshot(page, `${platform}-manual-login-timeout`);
  throw new Error(`Manual login was not completed for ${platform} within 10 minutes. Screenshot: ${screenshotPath}`);
};

const fillNumericFieldIfVisible = async (page: Page, selectors: string[], value?: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return false;
  }

  const locator = await findVisibleLocator(page, selectors);
  if (!locator) {
    return false;
  }

  await locator.fill(String(value));
  return true;
};

const prepareBid = async (context: BrowserContext, item: QueueItem, submit: boolean) => {
  const page = await context.newPage();
  await page.goto(item.link, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  await clickByText(page, [
    "Place Bid",
    "Make a proposal",
    "Bid on this project",
    "Apply",
    "Откликнуться",
    "Сделать ставку",
    "Предложить",
    "Оставить предложение",
  ]);

  await page.waitForTimeout(1500);

  await fillNumericFieldIfVisible(page, [
    "input[name*='amount']",
    "input[name*='price']",
    "input[id*='amount']",
    "input[id*='price']",
    "input[inputmode='numeric']",
  ], item.bidAmount);

  await fillNumericFieldIfVisible(page, [
    "input[name*='day']",
    "input[name*='term']",
    "input[name*='delivery']",
    "input[id*='day']",
    "input[id*='delivery']",
  ], item.deliveryDays);

  const textField = await findVisibleLocator(page, [
    "textarea",
    "[contenteditable='true']",
    "[role='textbox']",
    "form textarea",
  ]);

  if (!textField) {
    const screenshotPath = await saveScreenshot(page, `${item.platform}-${item.id}-no-textarea`);
    throw new Error(`Could not find bid text field for ${item.id}. Screenshot: ${screenshotPath}`);
  }

  await fillLocator(textField, item.bidText);
  await page.waitForTimeout(1000);

  const preparedShot = await saveScreenshot(page, `${item.platform}-${item.id}-prepared`);

  if (!submit) {
    return {
      status: "prepared",
      screenshot: preparedShot,
      link: item.link,
    };
  }

  const submitControl = await findVisibleLocator(page, [
    "button[type='submit']",
    "input[type='submit']",
    "button",
  ]);

  if (!submitControl) {
    throw new Error(`Could not find submit control for ${item.id}. Prepared screenshot: ${preparedShot}`);
  }

  await submitControl.click().catch(() => undefined);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(4000);

  const submittedShot = await saveScreenshot(page, `${item.platform}-${item.id}-submitted`);
  return {
    status: "submitted",
    screenshot: submittedShot,
    link: item.link,
  };
};

const main = async () => {
  loadEnv();
  ensureDir(logsDir);

  const options = parseArgs(process.argv.slice(2));
  const queue = readQueue(options.queuePath)
    .filter((item) => options.platform === "all" || item.platform === options.platform)
    .slice(0, options.limit ?? Number.MAX_SAFE_INTEGER);

  if (queue.length === 0) {
    throw new Error("No queue items matched the current filters.");
  }

  const missingPlatforms = Array.from(
    new Set(
      queue
        .map((item) => item.platform)
        .filter((platform) => {
          const creds = getCredentials(platform);
          return !creds.email || !creds.password;
        })
    )
  );

  if (options.checkOnly) {
    console.log(`Queue items: ${queue.length}`);
    console.log(`Mode: check`);
    console.log(`Platforms: ${Array.from(new Set(queue.map((item) => item.platform))).join(", ")}`);
    if (missingPlatforms.length > 0 && !options.manualLogin) {
      console.log(`Missing credentials: ${missingPlatforms.join(", ")}`);
      process.exitCode = 1;
      return;
    }
    console.log(options.manualLogin ? "Manual login mode enabled." : "Credentials look present for selected platforms.");
    return;
  }

  if (missingPlatforms.length > 0 && !options.manualLogin) {
    throw new Error(`Missing credentials for: ${missingPlatforms.join(", ")}. Fill .env.freelance first or use --manual-login.`);
  }

  const userDataDir = path.resolve(rootDir, process.env.FREELANCE_USER_DATA_DIR?.trim() || "sales/browser-profile");
  ensureDir(userDataDir);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: !options.headed,
    viewport: { width: 1440, height: 960 },
  });

  try {
    const loggedIn = new Set<Platform>();
    for (const item of queue) {
      if (!loggedIn.has(item.platform)) {
        if (options.manualLogin) {
          await waitForManualLogin(context, item.platform);
        } else {
          await loginPlatform(context, item.platform);
        }
        loggedIn.add(item.platform);
      }
    }

    const results: Array<Record<string, unknown>> = [];

    for (const item of queue) {
      try {
        const result = await prepareBid(context, item, options.submit);
        results.push({
          at: new Date().toISOString(),
          id: item.id,
          platform: item.platform,
          title: item.title,
          ...result,
        });
        console.log(`${String(result.status).toUpperCase()} ${item.platform} :: ${item.title}`);
      } catch (error) {
        results.push({
          at: new Date().toISOString(),
          id: item.id,
          platform: item.platform,
          title: item.title,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
        console.error(`FAILED ${item.platform} :: ${item.title} :: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const resultPath = path.resolve(logsDir, `freelance-bid-run-${nowStamp()}.json`);
    fs.writeFileSync(resultPath, JSON.stringify({ submit: options.submit, items: results }, null, 2), "utf8");
    console.log(`Result log: ${resultPath}`);
  } finally {
    await context.close();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
