# Owner decisions (2026-10-15) — override the specs where they differ

1. Canonical section order, used everywhere (map selector groups, area card sections/tabs, overview tile order, mobile + desktop):
   **Price → Getting around → Safety → Schools → Local places → Environment → Homes → People → Living costs**
   - Price = one short section holding price AND market data (was "Price & market").
   - Never merge unrelated things into one block: Homes (property types: detached/semi/terraced/flats, tenure, sizes) and People (ethnic group, religion, country of birth, age, household) are separate sections.
   - Local places = cafés, restaurants, pubs, shops, gyms, food hygiene (moved out of Living costs).
   - Living costs = council tax and other running costs only.
2. School TL;DR: short dated Ofsted quotes (OGL, linked, no logos) + Ofsted Parent View "N responses, X% agree" (no stars, no AI summaries).
3. Ship as 4 themed PRs: console fixes · dots + descriptions · top bar + sheet + layers · area card + schools + personalisation.
4. Admission distances (owner, 2026-10-15, after reading admissions-legal.md): SHOW ALL councils' last-offered distances, with per-council attribution and a link to the council source, like Locrating/School Atlas. Accepted risk: Barnet, Wandsworth and Kensington & Chelsea terms restrict reuse; on a takedown request, hide that council's distances.
5. Indexing when public (owner, 2026-10-15): /postcode/* and /property/* ARE indexed. A hidden or objected-to home must answer 404 + noindex so it drops out of search.
6. Shipping: commit and open each of the 4 themed PRs as soon as its theme passes review; the owner merges.
7. Migration 054 (area_london_rank) runs on production with the PR4 deploy (ship.sh), after a test on a database copy.
8. Trend arrows need n ≥ 10 observations. Map layers/settings/legend live apart from the area sheet (Layers button + legend chip).
9. School card (owner, 2026-10-15): show every row Locrating's premium card has, openly (no lock): details, pupils, inspections, strengths & weaknesses counts, results, Ofsted Parent View, admissions/oversubscription, last distance offered, destinations, workforce, financials — only from open (OGL) sources, never invented. REQUIRED: a national rank row "Ranked X of N schools (top N%)" across England (needs England-wide KS2/KS4 school-level data; London percentiles stay for the /10 ratings). Locrating's own user reviews are out of scope.
