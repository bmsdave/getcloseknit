import type { Page } from "./fixtures";

// The Environment tab draws flood bands and strategic noise only in Real mode,
// and the test server has no evidence API. These routes answer Real requests
// with the demo answers, relabelled so they are not "preview-" fixtures, and
// serve a fixed area-noise.v1 payload (the noise BFF has no demo answer).
export const REAL_AREA = "/?mode=real&release=official-2026-06&selected=uk%3Alsoa%3AE01000001";

export const REAL_NOISE = {
  schemaVersion: "area-noise.v1", productReleaseId: "rel-test", geographyId: "uk:lsoa:E01000001", available: true,
  dwellings: 362, road55Share: 0.569, rail55Share: 0.177, any55Share: 0.649, any65Share: 0.008, roadLdenMedian: 55.5,
  dwelling: null, sourceVersion: "src-defra-noise-round4-2022-road-rail-air",
  attribution: "Defra strategic noise mapping Round 4. Contains public sector information licensed under the Open Government Licence v3.0.",
  caveats: ["Modelled annual averages, not measurements."],
};

export async function routeRealEvidence(page: Page, noise: object = REAL_NOISE): Promise<void> {
  await page.route("**/api/v1/areas/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/noise")) return route.fulfill({ json: noise });
    if (url.searchParams.get("mode") === "real") {
      url.searchParams.set("mode", "demo");
      url.searchParams.set("release", "preview-2026-09");
    }
    const response = await route.fetch({ url: url.toString() });
    if (!(response.headers()["content-type"] ?? "").includes("json")) return route.fulfill({ response });
    const body = (await response.text()).replaceAll("\"preview-", "\"pilot-");
    return route.fulfill({ response, body });
  });
}
