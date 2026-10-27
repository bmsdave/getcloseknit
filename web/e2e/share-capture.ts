import type { Page } from "./fixtures";

/**
 * Takes over the share sheet and the clipboard so a test can read what was shared: no share sheet,
 * and the clipboard records each link. Call before page.goto.
 */
export async function captureShares(page: Page) {
  await page.addInitScript(() => {
    const shared: string[] = [];
    (window as unknown as { __shared: string[] }).__shared = shared;
    Object.defineProperty(Navigator.prototype, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (text: string) => { shared.push(text); } },
      configurable: true,
    });
  });
}

/** The last link shared on this page, or null. */
export async function lastShare(page: Page): Promise<string | null> {
  return page.evaluate(() => (window as unknown as { __shared?: string[] }).__shared?.at(-1) ?? null);
}
