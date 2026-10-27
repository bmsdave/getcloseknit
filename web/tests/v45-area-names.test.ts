import assert from "node:assert/strict";
import test from "node:test";

import { homeSummary, placeName } from "../src/components/property-profile";
import { areaUsed, type AreaPriceRange, type PropertyProfile } from "../src/lib/property-profile";
import { demoPropertyProfile } from "../src/lib/property-profile-fixture";

// v4.5 (round-2 findings 19 and 56, v4 Task 24): a home's page names its area, never "Southwark 028A".
const range = (level: AreaPriceRange["level"], areaName: string | null): AreaPriceRange => ({
  level, areaId: `uk:${level}:E01004001` as AreaPriceRange["areaId"], areaName, sales: 30, since: "2023-01", adjustedTo: "2026-06",
  p10: 1, p25: 2, p50: 3, p75: 4, p90: 5,
});

test("the area a home's prices use is said in words with its name, never a code or LSOA", () => {
  assert.equal(areaUsed(range("lsoa", "Peckham Rye Common · SE22")), "this neighbourhood: Peckham Rye Common · SE22");
  assert.equal(areaUsed(range("lsoa", "Southwark 028A")), "this neighbourhood");
  assert.equal(areaUsed(range("msoa", "City of London 001")), "the wider neighbourhood");
  assert.equal(areaUsed(range("borough", "Southwark")), "the borough: Southwark");
});

test("the home's lead line names its neighbourhood, else its borough, never a code", () => {
  const areas = (msoa: string | null, displayName: string | null): Pick<PropertyProfile, "areas"> => ({ areas: {
    lsoa: { id: "uk:lsoa:E01004001" as never, name: "Southwark 028A", displayName: null },
    msoa: msoa ? { id: "uk:msoa:E02000001" as never, name: msoa, displayName } : null,
    borough: { id: "uk:lad:E09000028" as never, name: "Southwark", displayName: "Southwark" },
  } });
  assert.equal(placeName(areas("Southwark 028", "Peckham Rye Common · SE22")), "Peckham Rye Common");
  assert.equal(placeName(areas("Southwark 028", "Southwark 028")), "Southwark");
  assert.equal(placeName(areas("Southwark 028", null)), "Southwark", "an old API without displayName");
  const profile = demoPropertyProfile("100000000001")?.profile;
  assert.ok(profile);
  assert.match(homeSummary(profile), / in St James's, /);
  assert.doesNotMatch(homeSummary(profile), /MSOA|[A-Za-z] \d{3}[A-Z]?\b/);
});
