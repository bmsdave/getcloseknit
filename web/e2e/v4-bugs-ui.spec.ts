import { expect, test, type Locator, type Page } from "./fixtures";

// v4.0 bugs-ui track: Task 26 (overlay and layout clashes), Task 30 (Compare polish),
// Task 31 (knit form controls). Computed layout, so desktop only; phones set their own viewport.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "each test sets the viewport it checks");
});

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function boxes(locator: Locator): Promise<Box[]> {
  return locator.evaluateAll((elements) => elements
    .filter((element) => element.getClientRects().length > 0)
    .map((element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
}

async function openCredits(page: Page): Promise<Box> {
  await page.goto("/");
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  await page.getByTestId("map-attribution-toggle").click();
  const card = page.getByTestId("map-credits-text");
  await expect(card).toBeVisible();
  return (await card.boundingBox())!;
}

test("Task 26: the ⓘ card never covers the map's round controls (desktop and a 390px phone)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let card = await openCredits(page);
  for (const box of await boxes(page.locator(".map-position button, .map-rail button"))) expect(overlaps(card, box)).toBe(false);

  await page.setViewportSize({ width: 390, height: 844 });
  card = await openCredits(page);
  const round = await boxes(page.locator(".map-rail button, .map-position button"));
  expect(round.length).toBeGreaterThan(0);
  for (const box of round) expect(overlaps(card, box)).toBe(false);
});

test("Task 26: a phone area page lays its four tags two to a row", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/area/lsoa/E01000001");
  const tags = page.getByTestId("area-tags").locator("li");
  await expect(tags.first()).toBeVisible();
  const tops = new Set((await boxes(tags)).map((box) => Math.round(box.y)));
  expect(tops.size).toBeLessThanOrEqual(Math.ceil((await tags.count()) / 2));
});

test("Task 30: the Compare switch keeps every label inside its pill, and the winner is marked", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/compare?kind=places&ids=uk:lsoa:E01000001,uk:lsoa:E01000002");
    const kinds = page.locator(".compare-kinds a");
    await expect(kinds).toHaveCount(3);
    const spill = await kinds.evaluateAll((links) => links.filter((link) => link.scrollWidth > link.clientWidth + 1).map((link) => link.textContent));
    expect(spill, `width ${width}`).toEqual([]);
    for (const box of await boxes(kinds)) expect(box.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByTestId("compare-best").first()).toBeVisible();
    await expect(page.getByTestId("compare-best").first()).toHaveAccessibleName(/Best/);
  }
});

async function nativeControls(page: Page): Promise<string[]> {
  return page.evaluate(() => [...document.querySelectorAll("button, input")].flatMap((element) => {
    const html = element as HTMLInputElement;
    if (html.getClientRects().length === 0) return [];
    const style = getComputedStyle(html);
    const name = (html.getAttribute("aria-label") ?? html.textContent ?? html.type).trim().slice(0, 40);
    if (style.borderTopStyle === "outset" || style.borderTopStyle === "inset") return [`grey button: ${name}`];
    if ((html.type === "checkbox" || html.type === "radio") && style.appearance !== "none" && style.opacity !== "0") return [`native ${html.type}: ${name}`];
    return [];
  }));
}

test("Task 31: the correction form is a knit card with a legend, ✕ and no browser-default controls", async ({ page }) => {
  await page.goto("/area/lsoa/E01000001");
  const safety = page.getByTestId("evidence-section-safety");
  await safety.getByTestId("correction-report-open").click();
  const form = safety.getByTestId("correction-report-form");
  await expect(form.getByRole("heading", { name: "Report a figure" })).toBeVisible();
  await expect(form.getByRole("group", { name: "Who got it wrong?" })).toBeVisible();
  await form.getByText("Close Knit got it wrong").click();
  await expect(form.getByTestId("correction-kind-transformation")).toBeChecked();
  // CUJ15 board: pick, then Send (no separate prepare step; r3 #7).
  await expect(form.getByTestId("correction-report-send")).toHaveText("Send");
  await expect(form.getByTestId("correction-report-prepare")).toHaveCount(0);
  expect(await nativeControls(page)).toEqual([]);
  await form.getByTestId("correction-report-close").click();
  await expect(form).toHaveCount(0);
  await expect(safety.getByTestId("correction-report-open")).toBeFocused();
});

test("Task 31: Show's tick-boxes are knit, not native", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  await page.getByTestId("show-toggle").click();
  await expect(page.getByTestId("map-overlays")).toBeVisible();
  expect(await nativeControls(page)).toEqual([]);
});

test("Task 31: tool prices are text fields with £ formatting", async ({ page }) => {
  await page.goto("/tools/stamp-duty");
  const price = page.getByTestId("sdlt-price");
  await expect(price).toHaveAttribute("type", "text");
  await expect(price).toHaveAttribute("inputmode", "numeric");
  await price.fill("525k");
  await expect(page.getByTestId("sdlt-total")).toHaveText("£16,250");
  await price.blur();
  await expect(price).toHaveValue("525,000");
  await page.goto("/tools/investor");
  for (const key of ["price", "deposit", "monthlyRent"]) await expect(page.getByTestId(`btl-${key}`)).toHaveAttribute("type", "text");
});
