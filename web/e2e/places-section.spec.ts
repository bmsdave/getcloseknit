import { expect, test } from "./fixtures";
import { openEvidenceSection } from "./evidence";
import { longParagraphs } from "./text-density";

const PAGE = "/area/lsoa/E01000001/places";

// v4 Task 16: the places page is the full list behind "All places →", in the area page's section frame;
// Getting around (score ring, station radar) lives on the area page only.
test("the places page lists Food & drink, Going out, Everyday and Your places, with no getting-around block", async ({ page }) => {
  await page.goto(PAGE);
  const section = page.getByTestId("places-section");
  await expect(section.locator(".area-section__title")).toHaveText(["Food & drink", "Going out", "Everyday", "Your places"]);
  await expect(page.locator("[data-testid=places-score], [data-testid=places-station-rings], .et-rings")).toHaveCount(0);
  await expect(page.getByText("Getting around and nearby")).toHaveCount(0);

  const everyday = page.getByTestId("evidence-section-everyday");
  await expect(everyday.getByTestId("places-count-groceries")).toContainText(/^Shops\d+ within 10 min · nearest /);
  await expect(everyday.getByTestId("places-count-pharmacies")).toContainText("Preview Pharmacy");
  await expect(everyday.getByTestId("places-count-gps")).toContainText("Preview Medical Centre");
  // A count without a listed nearest never claims there is none within 1.5 km.
  await expect(everyday.getByTestId("places-count-gyms")).toContainText(/^Gyms\d+ within 10 min$/);
  await expect(page.getByTestId("places-section")).not.toContainText(/[1-9]\d* within 10 min · none within/);
  await expect(page.getByTestId("places-parks")).toContainText("St James's Park");
  await expect(page.getByTestId("places-parks")).toContainText("Large park · 23 ha");
  // Each group lists its nearest places by name, nearest first, with the sources behind ⓘ.
  await expect(page.getByTestId("places-everyday-list").locator("li").first()).toBeVisible();
  await expect(everyday.getByTestId("card-sources-everyday")).toBeAttached();
  // Your places: nothing pinned yet, and the way to pin one.
  await expect(page.getByTestId("your-places-empty")).toHaveText("No places pinned yet.");
  await expect(page.getByTestId("pin-a-place")).toHaveAttribute("href", "/?layer=personal-match");
});

test("a home measures from the home and unknown areas are 404", async ({ page, request }) => {
  await page.goto(`${PAGE}?uprn=100000000001`);
  await expect(page.getByText("Straight-line distances from this home.")).toBeVisible();
  expect((await request.get("/api/v1/areas/uk%3Alsoa%3AE01999999/places")).status()).toBe(404);
  expect((await request.get("/api/v1/areas/uk%3Alsoa%3AE01000001/places?uprn=x")).status()).toBe(400);
});

// Buttons are 44px; a section's folded Sources is the area page's 32px fold (DESIGN.md §7: never under 24px).
test("controls are styled, big enough and fit the screen", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByTestId("places-parks")).toBeVisible();
  const report = await page.evaluate(() => {
    const section = document.querySelector("[data-testid=places-section]")!;
    const small: string[] = [];
    const unstyled: string[] = [];
    for (const element of section.querySelectorAll("button, summary")) {
      const box = element.getBoundingClientRect();
      const name = (element.getAttribute("aria-label") ?? element.textContent ?? "").trim();
      const floor = element.matches(".area-section__about > summary") ? 24 : 44;
      if (box.height < floor || box.width < floor) small.push(`${name} ${box.width}x${box.height}`);
      const style = getComputedStyle(element);
      if (style.borderTopStyle === "outset" || style.borderTopStyle === "inset") unstyled.push(name);
    }
    return { small, unstyled, overflow: document.documentElement.scrollWidth - window.innerWidth };
  });
  expect(report.small).toEqual([]);
  expect(report.unstyled).toEqual([]);
  expect(report.overflow).toBeLessThanOrEqual(0);
});

// Desktop Chrome is 1280×720; the phone project checks the phone.
test("the area card's Getting around opens on station rows (no bars) with no long paragraphs", async ({ page }) => {
  await page.goto("/?selected=uk%3Alsoa%3AE01000001");
  const section = await openEvidenceSection(page, "Getting around");
  // v3: a walk to a station is a row (time · zone · lines), never a bar or a ring.
  await expect(section.getByTestId("station-row").first()).toBeInViewport();
  await expect(section.getByTestId("getting-around-key-numbers")).toContainText("Zone");
  await expect(section.locator(".et-rings, .chart-bars, [data-testid=station-access]")).toHaveCount(0);
  expect(await longParagraphs(page)).toEqual([]);
});
