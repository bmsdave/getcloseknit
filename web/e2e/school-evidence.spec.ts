import { expect, test } from "./fixtures";
import { openEvidenceSection, openLink } from "./evidence";
import { longParagraphs } from "./text-density";
import { continueToReview } from "./wizard";
import { openMatchBuilder } from "./top-bar";

// My match's older extras (Saved areas & costs, Compare places, Tailor, Clear, Your data…) wait behind a default-off
// flag since v4.6 (lib/match-extras.ts): this spec covers them, so it turns them on for each page.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { for (const storage of [window.localStorage, window.sessionStorage]) storage.setItem("close-knit.match-extras", "on"); });
});

test("nearby schools have their own section, not Green & quiet", async ({ page }) => {
  await page.goto("/?selected=uk%3Alsoa%3AE01000001&period=2026-06");
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  const environment = await openEvidenceSection(page, "Environment");
  await expect(environment.getByTestId("flood-bands")).toBeVisible();
  await expect(environment.getByTestId("school-phases")).toHaveCount(0);
  const schools = await openEvidenceSection(page, "Schools");
  await expect(schools.getByTestId("school-phases")).toBeVisible();
  await expect(page.getByTestId("school-phases")).toHaveCount(1);
});

test("schools section: Primary | Secondary, the nearest of that phase within 1.5 km, each linked (board V3-33b)", async ({ page }) => {
  // Demo schools carry no distance; add the real API's fields to the fixture, plus one more primary
  // nearby and one beyond 1.5 km that the section leaves out (one radius everywhere). The browser reads
  // the section (no server-rendered seed), so the mock applies.
  await page.setExtraHTTPHeaders({ "x-close-knit-seed": "off" });
  await page.route("**/api/v1/areas/*/schools", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.radiusMetres = 1500;
    body.schools = body.schools.map((school: { distanceMetres?: number | null }, index: number) => (
      { ...school, distanceMetres: index === 0 ? 420 : index === 1 ? 880 : null }
    ));
    body.schools.push({ ...body.schools[0], schoolId: "uk:school:near", urn: "near", name: "Near Lane Primary", distanceMetres: 650 });
    body.schools.push({ ...body.schools[0], schoolId: "uk:school:far", urn: "far", name: "Far Away School", distanceMetres: 1700 });
    await route.fulfill({ response, json: body });
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/?selected=uk%3Alsoa%3AE01000001&period=2026-06");
  await expect(page.getByTestId("selected-area")).toBeVisible();
  const section = await openEvidenceSection(page, "Schools");

  // The headline counts the state schools within 1.5 km; the one beyond is never counted or listed.
  await expect(section.getByTestId("section-headline-schools")).toHaveText(/^4 within 1\.5 km/);
  await expect(section).not.toContainText("Far Away School");
  // Primary first (no children's ages given), each phase's count on its toggle.
  const phases = section.getByTestId("school-phases");
  await expect(phases.getByTestId("school-phase-primary")).toHaveAttribute("aria-pressed", "true");
  await expect(phases.getByTestId("school-phase-primary")).toHaveText("Primary · 3");
  await expect(phases.getByTestId("school-phase-secondary")).toHaveText("Secondary · 1");

  // One-line rows, nearest first (an unknown distance last); the distance stays in the row (no scale).
  const rows = phases.getByTestId("area-school-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Westminster Primary Preview");
  await expect(rows.nth(0)).toContainText("420 m");
  await expect(rows.nth(1)).toContainText("Near Lane Primary");
  await expect(rows.nth(1)).toContainText("650 m");
  await expect(rows.nth(2)).toContainText("distance unknown");
  for (const row of await rows.all()) {
    const name = (await row.locator(".school-row__name").boundingBox())!;
    const meta = (await row.locator(".school-row__meta").boundingBox())!;
    expect(Math.abs(name.y + name.height / 2 - (meta.y + meta.height / 2)), "name and meta on one line").toBeLessThan(4);
    expect(name.height, "the name never wraps").toBeLessThan(30);
  }
  await expect(rows.nth(0).getByTestId("area-school-link")).toHaveAttribute("href", "/school/100001?from=uk%3Alsoa%3AE01000001");
  // "Not a catchment" sits in the section's ⓘ, not in the body.
  await expect(page.getByTestId("card-sources-schools")).toContainText("Not a catchment");
  expect(await longParagraphs(page)).toEqual([]);

  // Secondary swaps the rows; the school's link opens its page, which knows where it came from.
  await phases.getByTestId("school-phase-secondary").click();
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText("North London Secondary Preview");
  await expect(rows.nth(0)).toContainText("880 m");
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await openLink(page, rows.nth(0).getByTestId("area-school-link"), /\/school\/100002\?from=uk%3Alsoa%3AE01000001$/);
});

test("school search, phase filter, date inspection, and shortlist", async ({ page }) => {
  await page.goto("/");
  await openMatchBuilder(page);
  await continueToReview(page);
  await page.getByTestId("refine-schools").locator("summary").click();

  const discovery = page.getByTestId("school-discovery");
  await expect(discovery).toBeVisible();

  await discovery.getByLabel("Search schools").fill("Westminster");
  await expect(discovery.getByTestId("school-card-100001")).toBeVisible();
  await expect(discovery.getByTestId("school-card-100002")).toHaveCount(0);

  await discovery.getByLabel("Search schools").fill("");
  await expect(discovery.getByTestId("school-card-100002")).toHaveCount(0);
  await page.getByRole("radiogroup", { name: "Schools you would use" }).getByRole("radio", { name: "Secondary" }).check();
  await expect(discovery.getByTestId("school-card-100002")).toBeVisible();
  await page.getByRole("radiogroup", { name: "Schools you would use" }).getByRole("radio", { name: "Primary" }).check();

  const westminster = discovery.getByTestId("school-card-100001");
  await expect(westminster).toContainText("2024/25");
  await expect(westminster.getByRole("link", { name: /Publisher record/ }).first()).toBeVisible();

  await discovery.getByLabel("Search schools").fill("Old Town");
  await expect(discovery.getByTestId("school-card-100003")).toContainText("Closed 2024-08-31");
  await discovery.getByLabel("Search schools").fill("");

  await discovery.getByLabel("Shortlist Westminster Primary Preview").check();
  await expect(discovery.getByLabel("Shortlist Westminster Primary Preview")).toBeChecked();

  await page.reload();
  await openMatchBuilder(page);
  await page.getByTestId("refine-schools").locator("summary").click();
  await expect(page.getByTestId("school-discovery").getByLabel("Shortlist Westminster Primary Preview")).toBeChecked();
});
