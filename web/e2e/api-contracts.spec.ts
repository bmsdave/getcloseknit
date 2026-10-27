import { expect, test } from "./fixtures";

test("v1 endpoints expose versioned public contracts", async ({ request }) => {
  const metrics = await request.get("/api/v1/metrics");
  expect(metrics.ok()).toBeTruthy();
  expect(await metrics.json()).toMatchObject({
    schemaVersion: "area-metrics.v1",
    metrics: expect.arrayContaining([
      expect.objectContaining({ id: "price-per-square-metre", provenance: expect.any(Object) }),
    ]),
  });

  const search = await request.get("/api/v1/search?q=SW1A");
  expect(await search.json()).toMatchObject({
    schemaVersion: "area-search.v1",
    results: expect.arrayContaining([expect.objectContaining({ geographyId: "uk:lsoa:E01000001" })]),
  });

  const area = await request.get(
    "/api/v1/areas/uk%3Alsoa%3AE01000001?metric=price-per-square-metre&period=2026-06",
  );
  expect(await area.json()).toMatchObject({
    schemaVersion: "area-summary.v1",
    summary: {
      value: 9_600,
      regionPercentile: 92,
      // Price percentiles are London-scoped only: the value-pack fixture
      // withholds the national percentile for price-per-square-metre
      // (valueEntry in fixtures.ts, AE-12 small-sample honesty), so the
      // summary contract pins null instead of a national rank.
      countryPercentile: null,
    },
  });

  const property = await request.get("/api/v1/properties/100000000001/history");
  expect(await property.json()).toMatchObject({
    schemaVersion: "property-history.v1",
    history: { uprn: "100000000001", transactions: expect.any(Array) },
  });

  const pack = await request.get("/api/v1/value-packs/crime/2026-06");
  expect(await pack.json()).toMatchObject({
    schemaVersion: "area-value-pack.v1",
    metricId: "crime",
    period: "2026-06",
    values: expect.any(Array),
  });
});

test("v1 endpoints reject unsupported metrics and periods", async ({ request }) => {
  const area = await request.get("/api/v1/areas/uk%3Alsoa%3AE01000001?metric=bogus");
  expect(area.status()).toBe(404);

  const pack = await request.get("/api/v1/value-packs/crime/1900-01");
  expect(pack.status()).toBe(404);
});

test("personal matching contracts expose factors and explained scores", async ({ request }) => {
  const factors = await request.get("/api/v1/factors");
  expect(await factors.json()).toMatchObject({
    schemaVersion: "factor-definitions.v1",
    factors: expect.arrayContaining([expect.objectContaining({ id: "affordability" })]),
  });

  const profile = {
    schemaVersion: "preference-profile.v1",
    market: "buy",
    targetBudget: 500000,
    maximumBudget: 650000,
    bedrooms: 2,
    forecastHorizon: "1y",
    factors: [{
      factorId: "crime", weight: 5, direction: "lower",
      minimumUtility: null, maximumUtility: null,
    }],
    commuteDestinations: [],
    school: {
      phases: ["primary"], characteristics: [],
      facetWeights: { progress: 3 }, shortlistUrns: [], desiredSchoolCount: 3,
    },
    analyticsConsent: false,
  };
  const response = await request.post("/api/v1/matches", { data: profile });
  expect(response.ok()).toBeTruthy();
  // PR #118 (v4.1 match model): match packs are v2.
  expect(await response.json()).toMatchObject({
    schemaVersion: "match-pack.v2",
    values: expect.arrayContaining([
      expect.objectContaining({ rank: 1, components: expect.any(Array) }),
    ]),
  });
});

test("school and forecast evidence remain sourced and non-probabilistic", async ({ request }) => {
  const schools = await request.get("/api/v1/schools?q=primary");
  const schoolPayload = await schools.json();
  expect(schoolPayload).toMatchObject({ schemaVersion: "school-search.v1" });
  expect(schoolPayload.schools).toEqual(expect.arrayContaining([
    expect.objectContaining({ schoolId: expect.stringMatching(/^uk:school:/) }),
  ]));
  // Closed schools stay listed with honest closure metadata instead of
  // vanishing from search (closureLabel in school-evidence.ts).
  expect(schoolPayload.schools).toEqual(expect.arrayContaining([
    expect.objectContaining({
      schoolId: "uk:school:100003",
      status: "closed",
      closedDate: "2024-08-31",
      successorUrn: "100001",
    }),
  ]));

  const areaSchools = await request.get("/api/v1/areas/uk%3Alsoa%3AE01000001/schools");
  expect(await areaSchools.json()).toMatchObject({
    schemaVersion: "area-schools.v1",
    schools: expect.arrayContaining([
      expect.objectContaining({ admissionEvidence: expect.objectContaining({ isProbability: false }) }),
    ]),
  });

  const forecast = await request.get("/api/v1/areas/uk%3Amsoa%3AE02000001/price-forecast?horizon=5y");
  expect(await forecast.json()).toMatchObject({
    schemaVersion: "price-forecast.v1",
    horizon: "5y",
    status: "failed-backtest",
    range: null,
    backtest: null,
    suppressionReason: expect.stringMatching(/validation/),
  });
});

test("commute matching returns an immediate pack or a pollable partial job", async ({ request }) => {
  const profile = {
    schemaVersion: "preference-profile.v1", market: "buy", targetBudget: 500000,
    maximumBudget: 650000, bedrooms: 2, forecastHorizon: "1y",
    factors: [{ factorId: "commute", weight: 5, direction: "lower", minimumUtility: null, maximumUtility: null }],
    commuteDestinations: [{
      id: "unique-job", label: "Work", latitude: 51.49991, longitude: -0.12991,
      mode: "transit", arrivalTime: "08:47", targetMinutes: 40, weight: 3,
    }],
    school: { phases: [], shortlistUrns: [], desiredSchoolCount: 3 }, analyticsConsent: false,
  };
  const queued = await request.post("/api/v1/matches", { data: profile });
  expect([200, 202]).toContain(queued.status());
  const payload = await queued.json();
  if (queued.status() === 200) {
    // PR #118 (v4.1 match model): match packs are v2.
    expect(payload).toMatchObject({ schemaVersion: "match-pack.v2" });
    return;
  }
  expect(payload).toMatchObject({ schemaVersion: "match-job.v1", partial: { schemaVersion: "match-pack.v2" } });

  await expect.poll(async () => {
    const response = await request.get(`/api/v1/matches/jobs/${payload.jobId}`);
    return response.status();
  }).toBe(200);
});
