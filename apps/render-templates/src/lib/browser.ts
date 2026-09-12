import puppeteer, { type Browser } from "puppeteer";

let browserPromise: Promise<Browser> | undefined;

/**
 * One shared Chromium instance for the whole process instead of a fresh
 * launch per render — launching is the slow part (seconds), a new page in
 * an already-running browser is fast.
 *
 * Confirmed live: Chromium can die mid-process (crash, OOM, whatever) while
 * this promise keeps resolving to the now-dead Browser object forever —
 * every render after that failed with "Connection closed" until the whole
 * Next.js process was restarted by hand, taking down 5 real AZ pieces in a
 * row with it. `isConnected()` catches exactly that and relaunches instead
 * of trusting a stale reference.
 */
function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({ headless: true });
  }
  return browserPromise.then((browser) => {
    if (browser.isConnected()) return browser;
    browserPromise = puppeteer.launch({ headless: true });
    return browserPromise;
  });
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
