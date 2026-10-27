import { expect, test } from "./fixtures";
import { continueToReview, findMyArea, matchItem } from "./wizard";
import { openMatchBuilder } from "./top-bar";

// v4 Task 8: a zone is the Where criterion, first in the order: inside fits fully, outside scores lower with distance
// and is never out (only a Must Where filters, in the panel rewrite). "Areas with similar figures" lists neighbourhoods
// with close crime, deprivation, income, price-level and station-access percentiles.
test("a station zone ranks the areas inside it first and keeps the rest scored", async ({ page }) => {
  await page.goto("/");
  await openMatchBuilder(page);
  await continueToReview(page);
  await findMyArea(page).getByTestId("chip-where").click();
  await findMyArea(page).getByTestId("where-add-station").click();
  await findMyArea(page).getByTestId("where-search").fill("westminster preview");
  await findMyArea(page).getByRole("button", { name: "Station: Westminster preview station" }).click();
  await expect(matchItem(page, "zone")).toContainText("Within 10 min walk of Westminster preview station");

  const ranking = page.getByTestId("match-top");
  await expect(ranking.getByTestId("match-row").first()).toContainText("Westminster preview");
  // Outside the zone the fit falls with distance: far out it scores 0, least like the search (21e red), never hidden.
  await page.getByTestId("match-list-bottom").click();
  await expect(page.getByTestId("match-bottom")).toContainText("North London preview");
  await page.getByTestId("match-list-top").click();

  // The share preview names the zone before any link exists.
  await page.getByTestId("share-search").click();
  await expect(page.getByTestId("share-preview")).toContainText("Zone: Within 10 min walk of Westminster preview station");
});

test("similar areas from a personal match honour cheaper and outside-zone filters", async ({ page }) => {
  await page.goto("/");
  await openMatchBuilder(page);
  await continueToReview(page);
  const ranking = page.getByTestId("match-ranking");
  await page.getByTestId("match-top").getByRole("button", { name: /^Rank \d+ Westminster preview/ }).click();
  // PR #135 (v4.4): the row opens the one area view; "← My match" goes back to the list with the area still chosen.
  await page.getByTestId("area-view-back").filter({ visible: true }).click();

  const similar = ranking.getByTestId("similar-areas");
  await expect(similar.getByRole("heading", { name: "Areas with similar figures" })).toBeVisible();
  await expect(similar.locator("a, button").filter({ hasText: /Find areas like/ })).toHaveCount(0);
  await expect(similar.getByTestId("similar-area")).toHaveCount(2);
  // Item 28: each chart row is the button, under its friendly name, listed once.
  const rows = similar.getByRole("button", { name: /(Highbury · N5|Bankside · SE1).*\d+\/100/ });
  await expect(rows).toHaveCount(2);
  await expect(similar.getByText("Highbury · N5", { exact: true })).toHaveCount(1);
  await expect(similar).toContainText("never compares who lives in an area");
  await expect(similar).not.toContainText(/\bbest\b/i);
  await expect(similar.getByLabel("Outside my zones")).toHaveCount(0);
  await similar.getByLabel("Cheaper only").check();
  await expect(similar).toContainText("Cheaper means a lower median price per m²");
  await expect(similar.getByTestId("similar-area")).toHaveCount(2);
});
