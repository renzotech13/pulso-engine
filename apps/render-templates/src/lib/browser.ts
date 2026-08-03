import puppeteer, { type Browser } from "puppeteer";

let browserPromise: Promise<Browser> | undefined;

/**
 * One shared Chromium instance for the whole process instead of a fresh
 * launch per render — launching is the slow part (seconds), a new page in
 * an already-running browser is fast.
 */
function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({ headless: true });
  }
  return browserPromise;
}

export async function screenshotPage(
  url: string,
  size: { width: number; height: number },
): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport(size);
    await page.goto(url, { waitUntil: "networkidle0", timeout: 15_000 });
    const screenshot = await page.screenshot({ type: "png" });
    return Buffer.from(screenshot);
  } finally {
    await page.close();
  }
}
