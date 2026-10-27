import { expect, test, type Page } from "./fixtures";
import { addTravel, continueToReview, openMoreOptions } from "./wizard";
import { openMatchBuilder } from "./top-bar";
import { openEvidenceSection } from "./evidence";
import { smallText, targetSizes } from "./target-size";

// UX-62: every button, tab, checkbox, and map control exposes at least a
// 44x44 pointer target; checkbox/radio inputs count via their labels.
async function undersizedTargets(page: Page) {
  return page.evaluate(() => {
    const bad: string[] = [];
    const check = (html: HTMLElement) => {
      if (html.getClientRects().length === 0) return;
      const box = html.getBoundingClientRect();
      // Rounded: a sheet still sliding in puts a 44px target on a sub-pixel offset (43.99 tall), not a smaller one.
      if (Math.round(box.width) < 44 || Math.round(box.height) < 44) {
        const name = (html.getAttribute("aria-label") ?? html.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 44);
        bad.push(`${Math.round(box.width)}x${Math.round(box.height)} <${html.tagName.toLowerCase()}> ${name}`);
      }
    };
    for (const element of document.querySelectorAll("button, [role='tab'], [role='checkbox'], [role='switch']")) {
      check(element as HTMLElement);
    }
    for (const element of document.querySelectorAll("input[type='checkbox'], input[type='radio']")) {
      const html = element as HTMLElement;
      check(html.closest("label") ?? html);
    }
    return bad;
  });
}

test("home and wizard targets meet 44px at desktop size", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  expect(await undersizedTargets(page)).toEqual([]);

  await openMatchBuilder(page);
  await expect(page.getByTestId("match-list")).toBeVisible();
  expect(await undersizedTargets(page)).toEqual([]);

  // Step 2: the rows' importance dots and Must, and More options.
  await continueToReview(page);
  await openMoreOptions(page);
  expect(await undersizedTargets(page)).toEqual([]);
});

test("evidence, matches, and comparison targets meet 44px at mobile size", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  expect(await undersizedTargets(page)).toEqual([]);

  await page.getByRole("combobox", { name: "Search", exact: true }).fill("SW1A");
  await page.getByRole("option", { name: /SW1A 1AA.*Westminster/ }).click();
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  await expect(page.getByTestId("brief-home")).toBeVisible();
  expect(await undersizedTargets(page), "brief").toEqual([]);
  await openEvidenceSection(page, "Price & market");
  expect(await undersizedTargets(page)).toEqual([]);
  // The tiles' Show all and the tags are targets too.
  await page.getByTestId("area-tiles-more").click();
  expect(await undersizedTargets(page)).toEqual([]);
  // Every section of the full page is open.
  await expect(page.getByTestId("school-phases")).toBeVisible();
  expect(await undersizedTargets(page), "full page").toEqual([]);

  await page.goto("/");
  await openMatchBuilder(page);
  await addTravel(page, "Highbury", /Highbury preview station/);
  await expect(await undersizedTargets(page)).toEqual([]);
  await continueToReview(page);
  await expect(page.getByTestId("match-ranking")).toContainText("match");
  // Measured once the sheet has slid up from its peek (mid-slide boxes carry sub-pixel error).
  await expect.poll(() => page.getByTestId("match-sheet").evaluate((node) => getComputedStyle(node).transform)).toBe("none");
  expect(await undersizedTargets(page)).toEqual([]);

  await page.getByRole("checkbox", { name: "Compare North London preview" }).click();
  await page.getByRole("checkbox", { name: "Compare South Bank preview" }).click();
  expect(await undersizedTargets(page)).toEqual([]);
});

test("keyboard focus keeps a visible outline", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.getByTestId("layers-toggle").focus();
  const focus = await page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return { visible: false, width: "0px" };
    return {
      visible: active.matches(":focus-visible"),
      width: getComputedStyle(active).outlineWidth,
    };
  });
  expect(focus.visible).toBe(true);
  expect(focus.width).not.toBe("0px");
});

// #15: at phone width no visible text renders under 12px (chart SVG text
// under 11px) and no control is under 24px. Controls between 24 and 44px are
// logged as warnings against the house 44px rule.
test("390px pages keep a 12px type floor and 24px targets", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const check = async (where: string) => {
    expect(await smallText(page), `${where}: text under the floor`).toEqual([]);
    const targets = await targetSizes(page);
    expect(targets.fail, `${where}: targets under 24px`).toEqual([]);
    if (targets.warn.length) testInfo.annotations.push({ type: "warning", description: `${where}: under 44px: ${targets.warn.join("; ")}` });
  };

  await page.goto("/");
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  await check("home");

  await openMatchBuilder(page);
  await expect(page.getByTestId("match-list")).toBeVisible();
  await check("wizard step 1");
  await continueToReview(page);
  await openMoreOptions(page);
  await check("wizard step 2");
  await expect(page.getByTestId("match-ranking")).toContainText("match");
  await check("results");

  // PR #106 keeps the map setup (My match stays the layer) and PR #121 rests the area sheet at its peek under
  // My match's sheet on a phone: the link names a layer so the area view opens.
  await page.goto("/?selected=uk%3Alsoa%3AE01000001&layer=price-per-square-metre");
  await expect(page.getByTestId("selected-area")).toBeVisible();
  await check("selected area");

  await page.goto("/area/lsoa/E01000001");
  await expect(page.getByTestId("school-phases")).toBeVisible();
  await check("area page");

  await page.goto("/postcode/sw1a-1ab");
  await expect(page.getByTestId("postcode-typical-price")).toContainText("£");
  // The sales chart redraws at its on-screen width once measured.
  await expect.poll(() => page.locator("[data-testid='postcode-sales-chart'] svg[role='img']").getAttribute("width")).not.toBe("640");
  await check("postcode page");

  await page.goto("/property/100000000001");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await check("property page");

  for (const urn of ["100001", "100002"]) {
    await page.goto(`/school/${urn}`);
    await expect(page.getByTestId("school-card")).toBeVisible();
    await check(`school page ${urn}`);
  }
});
