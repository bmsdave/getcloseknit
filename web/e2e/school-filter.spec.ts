import { expect, test, type Page } from "./fixtures";

import { openShowPanel } from "./top-bar";

// Schools filter v2 (board "School filter · 5 UI options", options 2 + 4): one filter object for the map's school
// markers, the /schools hub and My match, in one ?schools= text. Preview points (app/api/v1/schools/points): the
// preview's primaries carry KS2 (illustrative), the secondary Grade 5+ and Progress 8, the private school none.

const AT = { lng: -0.151, lat: 51.506 };

interface PreviewPoint { urn: string; phase: string; kind?: string; measures?: Record<string, [number, string]> }

async function openMap(page: Page, query = "schools=on") {
  const points = page.waitForResponse((response) => response.url().includes("/api/v1/schools/points"));
  await page.goto(`/?lat=${AT.lat}&lng=${AT.lng}&zoom=13&${query}&stations=off&diagnostics=1`);
  await expect(page.locator(".map-status")).toHaveText("Map ready", { timeout: 30_000 });
  const body = await (await points).json() as { schools: PreviewPoint[] };
  await expect.poll(() => page.evaluate(() => window.__closeKnitDiagnostics?.layerIds().includes("school-points") ?? false)).toBe(true);
  return body.schools;
}

const schools = (n: number) => `${n} ${n === 1 ? "school" : "schools"}`;
const capFaded = (page: Page) => page.evaluate(() => window.__closeKnitDiagnostics.renderedPoints("school-points")
  .map((point) => Number((point.properties as { faded?: number }).faded ?? 0)));

test("the Schools filter: a live count and Reset; one measure colours the caps with a key, its threshold narrows them", async ({ page }) => {
  const points = await openMap(page);
  const panel = (await openShowPanel(page)).getByTestId("school-legend");
  const count = panel.getByTestId("school-filter-count");
  await expect(count).toHaveText(schools(points.length));
  await expect(panel.getByTestId("school-filter-reset")).toBeDisabled();

  // Option 4: colour by KS2. Nobody is dropped; the schools without KS2 are faded; the map gets the colour key.
  await panel.getByTestId("school-measure").selectOption("ks2RwmExpected");
  await expect(page).toHaveURL(/schools=m\.ks2(&|$)/);
  await expect(count).toHaveText(schools(points.length));
  await expect(panel.getByTestId("school-measure-key").locator("li")).toHaveCount(5);
  const legend = page.getByTestId("school-measure-legend");
  await expect(legend).toContainText("KS2 expected standard");
  await expect(legend.getByTestId("school-measure-key").locator("li")).toHaveText(["below 55%", "55–70%", "70–85%", "85% and above", "no data"]);
  await expect.poll(() => capFaded(page)).toContain(1);

  // Its threshold: one slider; the count, the address and the summary follow.
  await panel.getByTestId("school-threshold-on").getByRole("checkbox").check();
  await expect(page).toHaveURL(/schools=m\.ks2\.75/);
  await panel.getByTestId("school-threshold").fill("65");
  await expect(page).toHaveURL(/schools=m\.ks2\.65/);
  const kept = points.filter((point) => (point.measures?.ks2RwmExpected?.[0] ?? -1) >= 65).length;
  expect(kept).toBeGreaterThan(0);
  expect(kept).toBeLessThan(points.length);
  await expect(count).toHaveText(schools(kept));
  await expect(panel.getByTestId("school-filter-summary")).toHaveText("KS2 expected standard ≥ 65%");
  // With a threshold the schools without the measure leave the map instead of fading.
  await expect.poll(() => capFaded(page)).not.toContain(1);

  // The chips (shared with /schools): Girls writes its own segment before the measure.
  await panel.getByTestId("school-filter-intake").getByRole("button", { name: "Girls" }).click();
  await expect(page).toHaveURL(/schools=g\.girls_m\.ks2\.65/);
  await expect(panel.getByTestId("school-filter-intake").getByRole("button", { name: "Girls" })).toHaveAttribute("aria-pressed", "true");

  // A reload keeps it; Reset puts every school and the Ofsted colours back.
  await page.reload();
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  const again = (await openShowPanel(page)).getByTestId("school-legend");
  await expect(again.getByTestId("school-measure")).toHaveValue("ks2RwmExpected");
  await again.getByTestId("school-filter-reset").click();
  await expect(page).toHaveURL(/schools=on/);
  await expect(page.getByTestId("school-measure-legend")).toHaveCount(0);
  await expect(again.getByTestId("school-filter-count")).toHaveText(schools(points.length));
});

test("Use in My match: the same filter becomes a place, near a school like this", async ({ page }) => {
  await openMap(page, "schools=t.p_m.ks2.75");
  const panel = (await openShowPanel(page)).getByTestId("school-legend");
  await expect(panel.getByTestId("school-filter-summary")).toHaveText("Primary · KS2 expected standard ≥ 75%");
  await panel.getByTestId("school-filter-match").click();
  await expect(page.getByTestId("match-item").filter({ hasText: "KS2 expected standard ≥ 75%" }).first()).toBeVisible();
  const stored = await page.evaluate(() => Object.values(window.localStorage).find((value) => value.includes("school-filter")) ?? "");
  expect(stored).toContain('"filter":"t.p_m.ks2.75"');
});

test("/schools reads the same filter: its chips write ?schools= and the list follows; On the map carries it over", async ({ page }) => {
  // The preview's Westminster primary has KS2 71% (illustrative): ≥ 80% keeps none, ≥ 65% keeps it.
  await page.goto("/schools?borough=westminster&schools=t.p_m.ks2.80");
  await expect(page.getByTestId("schools-none")).toBeVisible();
  await page.goto("/schools?borough=westminster&schools=t.p_m.ks2.65");
  const list = page.getByTestId("schools-list");
  await expect(page.getByTestId("filter-phase").getByRole("link", { name: "Primary" })).toHaveAttribute("aria-current", "true");
  await expect(page.getByTestId("filter-results").getByRole("link", { name: "KS2 expected standard ≥ 65%" })).toHaveAttribute("aria-current", "true");
  await expect(list.getByTestId("schools-row")).toHaveCount(1);
  await expect(page.getByTestId("schools-on-map")).toHaveAttribute("href", "/?schools=t.p_m.ks2.65");
  // Any results: the phase kept, the measure gone; a Secondary chip swaps the phase.
  await page.getByTestId("filter-results").getByRole("link", { name: "Any" }).click();
  await page.waitForURL(/schools=t\.p(&|$)/);
  await expect(list.getByTestId("schools-row")).toHaveCount(1);
  await page.getByTestId("filter-ofsted").getByRole("link", { name: "Good or better" }).click();
  await page.waitForURL(/schools=t\.p_o\.out\.good(&|$)/);
  // Older hub links still read.
  await page.goto("/schools?borough=westminster&phase=primary");
  await expect(page.getByTestId("filter-phase").getByRole("link", { name: "Primary" })).toHaveAttribute("aria-current", "true");
});

test.describe("390 px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the Schools filter and the hub's chips fit a phone without sideways scroll, by Day and by Night", async ({ page }) => {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await openMap(page, "schools=m.ks2.75");
      const show = await openShowPanel(page);
      const panel = show.getByTestId("school-legend");
      await panel.getByTestId("school-threshold").scrollIntoViewIfNeeded();
      await expect(panel.getByTestId("school-threshold")).toBeVisible();
      const box = await panel.boundingBox();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      // The chosen chip is the primary in both themes (tokens, never a hard-coded colour).
      const chosen = panel.getByTestId("school-filter-type").getByRole("button", { name: "Any" });
      const [fill, text] = await chosen.evaluate((node) => [getComputedStyle(node).backgroundColor, getComputedStyle(node).color]);
      expect(fill).not.toBe(text);
      await page.goto("/schools?schools=t.p");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    }
  });
});
