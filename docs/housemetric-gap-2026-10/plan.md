# Housemetric gap plan (2026-10-16)

Reviewed: `/map/`, the property page (116 Meadvale Road, W5 1LR), the
postcode page (W5 1LR), the street page (Meadvale Road, W5 1L) and the sector
page (W5 1). This plan lists what they show that we don't, and the order to add
it. Anything that needs legal review ships behind its own flag, off by default.

Inventory of our side: area pages (LSOA/MSOA/borough), postcode pages,
property pages; flags are `CLOSE_KNIT_*` env vars gated server-side (pattern:
`api/area_api/epc_policy.py`).

## Gaps

| # | Housemetric feature | Level | Data | Gate |
|---|---|---|---|---|
| 1 | Postcode **sector** as a geography (W5 1): own page, boundary, search by sector/district | zone | ONSPD / Code-Point Open (OGL) | none |
| 2 | £/m² **distribution**: histogram + box plot (p9/p25/p50/p75/p91) vs parent district, n= | zone | HMLR + EPC floor area, aggregated (we already serve area median £/m², migration 014) | none (aggregate) |
| 3 | **House price index** since 2004, nominal + CPI-real, houses vs flats at borough level | zone | HMLR + ONS CPI (OGL) | none |
| 4 | **Historic returns** table 1/5/10/20 y, total + CAGR, nominal + real, vs district | zone | as #3 | none |
| 5 | **Neighbouring sectors** table: quartile £/m², sales in 2 y | zone | as #2 | none |
| 6 | **Streets in the zone** table: avg size, avg £/m², recent sales | zone | as #2, OS Open Names | none (aggregate, ≥5 sales) |
| 7 | **Street page**: postcodes on the street, sales list, street median £/m², avg size, est. home count, expected vs actual turnover | street | HMLR, OS Open UPRN, OS Open Names | street aggregates: none; per-sale £/m² column: **EPC** flag |
| 8 | Map layers: £/m² and growth (1/3/5/10/20 y) choropleths | map | as #2–#3 | none |
| 9 | Freehold plot outline + plot size on property page | home | INSPIRE (already loaded for map fill) | **INSPIRE** flag: confirm per-parcel display/area is within the conditions ("not to identify ownership") |
| 10 | Per-home EPC facts: floor area, rooms, age band, rating, walls/roof/heating, certificate link | home | EPC (already wired, served null) | **EPC** flag (`CLOSE_KNIT_EPC_PER_HOME`, existing). Walls/roof/heating are new fields → add to the counsel question |
| 11 | Per-sale £/m² and the gain between sales (annual %, after inflation) | home | HMLR + EPC + CPI | gain between sales: none (HMLR fact). £/m² per sale: **EPC** flag + owner decision 044 |
| 12 | Map pins: EPC inspections | map | EPC | **EPC** flag |
| 13 | Map pins: planning applications | map | Planning London Datahub (centroid only, migration 030) | **Planning** flag: licence not stated on datahub page (`DATA-LICENCES.md:54`) |
| 14 | Council tax band per home | home | VOA (no open bulk licence; the GOV.UK lookup forbids scraping) | **Council tax** flag; blocked until a licensed source exists |
| 15 | Snakes & ladders: named addresses with the biggest gains/losses | zone | HMLR repeat sales | **Snakes** flag: naming a home's loss is a privacy/reputation question; fallback = street-level only |

## Not planned (conflicts with standing decisions)

- **Per-home value** ("indexed to today £1,037k", valuation range, plot-level
  "current value" heat map): owner decisions in migrations 040/044 and memory
  "no per-home valuation". Revisit only if the owner reverses that.
- **Archived listings**: agent photos, floor plans, advert remarks, days
  listed. Scraped portal content under agent copyright/portal terms. No.
- **Social housing pins** and **EPC tenure** per home: describes occupants;
  already excluded by `test_payload_carries_no_occupant_fields`.
- Paywalled CSV export: not a data gap.

## Flags

One env var per legal question, so each can turn on when cleared. All off in
prod, on in dev and staging.

| Flag | Covers | Clears when |
|---|---|---|
| `CLOSE_KNIT_EPC_PER_HOME` (exists) | #7 per-sale £/m², #10, #11 £/m², #12 | counsel confirms EPC terms (`RELEASE-CHECKLIST.md:293`), plus the owner re-decides on 044 for per-home £/m² |
| `CLOSE_KNIT_PLOT_OUTLINE` | #9 | INSPIRE conditions check |
| `CLOSE_KNIT_PLANNING_PINS` | #13 | GLA confirms OGL in writing |
| `CLOSE_KNIT_COUNCIL_TAX_BAND` | #14 | licensed VOA source found |
| `CLOSE_KNIT_SNAKES` | #15 | privacy review (LIA in `docs/legal/legitimate-interests-assessment.md`) |

Implementation: copy the `epc_policy.py` pattern into one `feature_policy.py`
(read env once, `enabled(name)`), null the fields in the API when off, and the
web shows nothing (not "locked"). Keep `test_minimisation.py` guarding the
off state.

## Order

1. **Sector geography** (#1): table + boundaries + routes `/sector/W5-1`;
   everything else at zone level hangs off it. Also run #2–#6 for LSOA/MSOA.
2. **Zone analytics** (#2–#6): one materialised view per sector of £/m²
   percentiles, index by year and type, CPI-real returns. Charts on the area page.
3. **Street page** (#7): aggregates only; per-sale £/m² behind the EPC flag.
4. **Map layers** (#8).
5. **Flagged home items** (#9–#12): build now, off in prod.
6. **Flagged extras** (#13–#15): only after their gate is cleared or near it.

## Legal questions to send

1. EPC: may we show, per home, floor area, the fields listed in
   `DATA-LICENCES.md:16`, plus walls/roof/heating descriptions and £/m² per sale?
2. INSPIRE: may we show one parcel outline and its area on a property page?
3. Planning London Datahub: written confirmation of OGL v3.0.
4. VOA council tax bands: is there a licensed bulk source?
5. Naming individual homes with the largest price falls: is that within our LIA?
