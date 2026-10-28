import { expect, test } from "./fixtures";

// /changelog (board KHt56r65, option A): one "Changelog" link in the shared footer, RSS autodiscovery in the head,
// each entry on its own page with Copy link, X, Bluesky and Mastodon.

test("the footer's Changelog link opens /changelog, newest entry first", async ({ page }) => {
  await page.goto("/about");
  await page.getByTestId("site-footer").getByRole("link", { name: "Changelog" }).click();
  await expect(page).toHaveURL(/\/changelog$/);
  await expect(page.getByRole("heading", { level: 1, name: "Changelog" })).toBeVisible();
  await expect(page.locator('link[rel="alternate"][type="application/rss+xml"]')).toHaveAttribute("href", /\/changelog\/rss\.xml$/);
  const first = page.getByTestId("changelog-entry").first();
  await expect(first).toHaveAttribute("data-slug", "close-knit-is-public");
  await expect(first.getByTestId("changelog-number")).toContainText("296");
  await expect(first.getByTestId("changelog-bullets").getByRole("listitem")).toHaveCount(5);
});

test("an entry page renders its bullets, number and share links", async ({ page }) => {
  await page.goto("/changelog");
  await page.getByRole("link", { name: "Close Knit is public" }).click();
  await expect(page).toHaveURL(/\/changelog\/close-knit-is-public$/);
  const entry = page.getByTestId("changelog-entry-page");
  await expect(entry.getByRole("heading", { level: 1 })).toHaveText("Close Knit is public");
  await expect(entry).toContainText("Week 44");
  await expect(entry).toContainText("submitted to the Claude directory and 30+ catalogues");
  await expect(entry.getByTestId("changelog-number")).toContainText("local authorities with area data, in 9 regions");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/changelog\/close-knit-is-public\/opengraph-image/);
  await expect(page.locator('link[rel="alternate"][type="application/rss+xml"]')).toHaveCount(1);

  const share = page.getByTestId("changelog-share");
  await expect(share.getByTestId("changelog-copy")).toBeVisible();
  await expect(share.getByTestId("changelog-share-x")).toHaveAttribute("href", /^https:\/\/x\.com\/intent\/post\?text=Week%2044/);
  await expect(share.getByTestId("changelog-share-bluesky")).toHaveAttribute("href", /^https:\/\/bsky\.app\/intent\/compose\?text=/);
  await share.getByTestId("changelog-share-mastodon").click();
  await expect(share.getByLabel("Your server")).toHaveValue("mastodon.social");
  await expect(page.locator('a[href*="facebook"], a[href*="instagram"], a[href*="threads.net"], a[href*="whatsapp"]')).toHaveCount(0);
});

test("the feed is RSS 2.0 with the launch entry", async ({ request }) => {
  const response = await request.get("/changelog/rss.xml");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("application/rss+xml");
  const body = await response.text();
  expect(body).toContain('<rss version="2.0"');
  expect(body).toMatch(/<link>[^<]+\/changelog\/close-knit-is-public<\/link>/);
});
