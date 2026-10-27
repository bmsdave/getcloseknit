import { expect, test } from "./fixtures";

// The area view answers for today even when the price timeline is scrubbed
// back to a year before crime figures exist: its tiles are the area's standouts (v4 Task 12).
test("an old timeline period keeps today's crime answer in the area view", async ({ page }) => {
  await page.goto("/?selected=uk%3Alsoa%3AE01000001&period=2010-06");
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  const panel = page.getByTestId("evidence-panel");
  await expect(panel.getByTestId("area-tile-safety")).toContainText("More crime than 92%");
  await expect(panel).not.toContainText("no recent crime figures");
});

test("the safety tile reads one figure on every layer", async ({ page }) => {
  const safetyOn = async (layer: string) => {
    await page.goto(`/?selected=uk%3Alsoa%3AE01000001&layer=${layer}`);
    const tile = page.getByTestId("evidence-panel").getByTestId("area-tile-safety");
    await expect(tile).toContainText("More crime than");
    return tile.innerText();
  };
  const onPrice = await safetyOn("price-per-square-metre");
  expect(await safetyOn("crime")).toBe(onPrice);
  await expect(page.getByTestId("raw-value")).toHaveCount(0);
});

test("an old timeline period keeps today's price on the tiles", async ({ page }) => {
  await page.goto("/?selected=uk%3Alsoa%3AE01000001&period=2010-06");
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  await expect(page.getByTestId("evidence-panel").getByTestId("area-tile-price")).toContainText("£9,600/m²");
});
