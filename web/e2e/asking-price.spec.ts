import { expect, test } from "./fixtures";

// Review #16: "Is the asking price fair?" on the property and postcode pages.
// The entered price is never kept: no storage, no URL, no request carries it.

for (const path of ["/property/100000000001", "/postcode/sw1a-1ab"]) {
  test(`${path}: an asking price gets an answer and is gone after a reload`, async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(`${request.url()} ${request.postData() ?? ""}`));
    await page.goto(path);
    const check = page.getByTestId("asking-price-check");
    await expect(check.getByRole("heading", { name: "Is the asking price fair?" })).toBeVisible();
    await expect(check.getByTestId("asking-price-note")).toContainText("Not a valuation.");
    const input = check.getByRole("textbox", { name: "Asking price" });
    await expect(input).toHaveAttribute("inputmode", "numeric");
    const before = requests.length;
    await input.fill("987654");
    const answer = check.getByRole("status");
    await expect(answer).toContainText(/^£987,654 is \d+% (above|below) (the|this home.s last recorded sale) /);
    await expect(answer).toContainText("the middle half of");
    await expect(check).not.toContainText(/worth|value of this home/i);

    expect(page.url()).not.toContain("987654");
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie);
    expect(stored).not.toContain("987654");
    expect(requests.slice(before).filter((entry) => entry.includes("987654"))).toEqual([]);

    await page.reload();
    await expect(page.getByTestId("asking-price-check").getByRole("textbox", { name: "Asking price" })).toHaveValue("");
  });
}

test("a price that is not a number asks for one", async ({ page }) => {
  await page.goto("/property/100000000001");
  const check = page.getByTestId("asking-price-check");
  await check.getByRole("textbox", { name: "Asking price" }).fill("ask agent");
  await expect(check.getByRole("status")).toHaveText("Type a price in pounds, like 650000.");
});

test("on a home's page the asking price is set against its recorded sale and the area's range, never an estimate", async ({ page }) => {
  await page.goto("/property/100000000001");
  const check = page.getByTestId("asking-price-check");
  await check.getByRole("textbox", { name: "Asking price" }).fill("650000");
  await expect(check.getByRole("status")).toHaveText(
    "£650,000 is 14% above this home's last recorded sale (£570k, 3 Nov 2022) and inside the middle half of flat sales here, adjusted to Jun 2026 (£520k–£760k).");
  await expect(check).not.toContainText(/restated|estimate|~£|\/m²/i);
});
