# School card spec (v1)

## 1. Entry points
- **Area school list** (`web/src/components/area-schools.tsx`, `SchoolItem`). The school name becomes a link to `/school/{urn}`. The "Inspections and results" disclosure stays as a secondary element.
- **Map popup** (`web/src/components/match/match-overlays.tsx:264-273`). Add a "School card →" link to the popup HTML.
- **Indexable page `/school/[urn]`**, a server-rendered page that renders `SchoolCard`.
  - Title: `{Name} – Ofsted {grade} ({year}) · {KS2|GCSE} results {year} | Close Knit`. The h1 is the school name.
  - Canonical `/school/{urn}`.
  - JSON-LD: `ElementarySchool`, `HighSchool` or `School`, with name, address (postcode), geo and url. **No `aggregateRating`.**
  - A closed school with a `successor_urn` gets a 301 to the successor.
  - Add the page to the sitemap only when the school has at least one result or inspection; otherwise mark it `noindex`.
- A dock side panel is out of v1. Follow-up: reuse `SchoolCard` in `map-dock` via `?school=`.

## 2. Card anatomy, top to bottom
1. **Header**
   - Name, then a line: phase · type · ages {from}–{to} · faith · selective · LA · postcode.
   - Distance only when the page is opened with `?from={areaId}` (the area list passes it).
   - Badge row:
     - Ofsted chip: legacy grade plus date, **or** for the report-card framework a mini grid of the 5-point area grades plus safeguarding Met / Not met. Never mix the two.
     - "Top school" badge, with a tooltip giving the one-line criteria and year.
     - Small chips (§3).
2. **KPI row**: 3–4 `ScoreRating` tiles by phase.
   - Primary: `ks2-rwm-expected`, `ks2-rwm-higher`, `ks2-reading-score`, `ks2-maths-score`.
   - Secondary: `ks4-attainment8`, `ks4-em-grade5`, `ks4-ebacc-aps`, and `ks4-progress8` labelled with its last year (2023/24).
   - Sixth form tile: `ks5-alevel-aps`.
3. **Results chart**: small multiples, one line per headline measure from 2015/16 to the latest year.
   - A dashed line shows the London median for each year.
   - 2019/20 and 2020/21 show a labelled gap: "No exams".
   - Suppressed years show a hollow dot.
   - Tooltip: value, cohort, year.
   - Reuse `sparkline.tsx` and the `charts/*` primitives. No new dependencies.
4. **TL;DR**: "Strengths" and "To improve", at most 3 bullets each. Show it only when the inspection holds text.
   - Bullets are extractive: whole sentences of 160 characters or fewer, taken from `keyFindings` and `improveText` of the latest inspection that has text.
   - Label: "From Ofsted report, {publicationDate}", with a link to `reportUrl`, plus "(inspected as predecessor)" when `inspectedUrn ≠ urn`.
5. **Inspection timeline**: one dot per inspection, coloured by grade, each linking to its report.
6. **Parent View**: not loaded, so the **section is omitted**. No stars, ever.
7. **Summary numbers**: icon plus number tiles.
   - Pupils on roll, with a pupils series sparkline.
   - Capacity and fill %, only if present in `attributes`.
   - Exam cohort: "{n} took GCSEs / KS2 in {year}" (`cohort_size`), and `ks5-students`.
   - Destinations, FSM, EAL and SEN: omit them until they are loaded.
8. **Admissions**: from the latest `demand` row.
   - Applications per place (`anyPreferences / pan`), first preferences per place, and offers.
   - Last distance offered **only** from publishable `distances`, with the year and the council.
9. **Homes around this school**: a link to the area page that contains the school.
10. **Sources**: OGL attributions from `sources[]` plus a methodology link. No Ofsted logo.

Text budget: no paragraphs. Labels are 6 words or fewer and bullets are 160 characters or fewer.

## 3. "Top school" badge (computed server-side)
**Percentile pool**
- London state schools in the DB.
- Same `school.phase`, same measure, same academic year.
- Not suppressed, and `cohort_size >= MIN_SCHOOL_COHORT` (30).
- Value: `percent_rank()*100`.
- The latest year with data is used and shown on the badge.

**Phase rules**
- **Primary:** `ks2-rwm-expected` at P90 or above **and** `ks2-rwm-higher` at P75 or above.
- **Secondary:** `ks4-attainment8` at P90 or above **and** `ks4-em-grade5` at P75 or above.
- **Both phases also need an inspection gate:** the latest overall grade is 1 or 2, **or** a report card has no area below Expected and safeguarding Met. A school with no inspection gets no badge.

**Other chips**
- "Top 10% results": headline measure at P90 or above.
- "Exceptional in {area}".
- "Strong sixth form": `ks5-alevel-aps` at P75 or above.
- "Rising" / "Falling": the headline percentile moved by 5 points or more against the exam year 3 data-years earlier.

**Missing data:** show the chip "Not enough data" with a reason (small cohort, suppressed, new school, or not inspected).

**One-line explanation**, e.g. "Top school: top 10% London KS2 RWM 2024/25 · Ofsted Good". The same `topBadge` object appears in the area school list.

## 4. `ScoreRating` contract (shared area-card component)
```ts
{ label: string; valueText: string;            // real formatted value, e.g. "78%", "52.3"
  percentile: number | null;                    // 0–100 vs pool; null → missingReason
  score10?: number | null;                      // default = round(percentile/10, 1)
  trend?: { direction: 'up'|'down'|'flat'; deltaPoints: number; fromYear: string } | null;
  year: string; basis: string;                  // "vs 1,512 London primaries, cohort 30+"
  missingReason?: string; href?: string }       // methodology anchor
```
- Tone bands come from DESIGN.md tokens: at P75 or above, P25 to P75, below P25.
- Import the component from wherever the area-card stream lands it. Do not fork it.

## 5. API and pipeline
- **New `GET /api/v1/schools/{urn}/card`** returning `school-card.v1`:
  - `school_summary` plus `school_history`.
  - `percentiles` per measure and year.
  - `londonMedian` per measure and year.
  - `topBadge` `{isTop, chips[], line, year, reasons[]}`.
  - `tldr` `{strengths[], improve[], inspectionDate, reportUrl}`.
  - `areaId`.
- **`GET /api/v1/schools/index`**: urn, name, phase and hasEvidence, for the sitemap.
- **Percentiles and medians** are one SQL pass per (measure, year), cached in-process keyed by the active release. No migration.
- **TL;DR** is a pure deterministic sentence picker at request time. No LLM, no pipeline step.
- **`school_summary`** gains `topBadge`.
- Parent View loading is deferred (gap).

## 6. Slices (disjoint files)
**A. API**
- Files:
  - `api/area_api/school_card.py` (new: percentiles, badge, tldr, card)
  - `api/area_api/app.py`
  - `api/area_api/evidence.py`
  - `api/area_api/schools.py` (`topBadge` in summary)
  - `api/tests/test_school_card.py`
- Acceptance:
  - pytest green, covering: badge true and false cases, suppressed or small cohort giving "Not enough data", report-card gate, tldr of 3 or fewer whole sentences, predecessor label.
  - `curl :8080/api/v1/schools/{urn}/card` against `ae-pgold` returns values equal to `school_observation` rows (spot-check 3 URNs via `docker exec ae-pgold psql`).

**B. Web route, data, SEO**
- Files:
  - `web/src/app/school/[urn]/page.tsx`
  - `web/src/lib/school-card.ts` (types and fetch)
  - `web/src/app/api/v1/schools/[urn]/card/route.ts`
  - `web/src/lib/seo.ts`
  - `web/src/app/sitemap.ts`
  - `web/src/lib/fixtures.ts` (demo card)
- Acceptance:
  - `tsc --noEmit`.
  - Page HTML has the title, h1, canonical and JSON-LD.
  - Sitemap lists `/school/…` entries.

**C. Card UI**
- Files:
  - `web/src/components/school/school-card.tsx`
  - `web/src/components/school/school-card.css`
  - `web/e2e/school-card.spec.ts`
- Acceptance:
  - The e2e (demo mode) shows the badges, KPI tiles, a chart with the "No exams" gap, and TL;DR with the report link.
  - At 375px wide there is no horizontal scroll.
  - Dark mode is checked.

**D. Entry points**
- Files:
  - `web/src/components/area-schools.tsx`
  - `web/src/components/match/match-overlays.tsx`
- Acceptance:
  - e2e: clicking a school in the area list and in the map popup lands on `/school/{urn}`.
  - The Top chip shows in the list.

Order: A ∥ (B needs A's types; agree on the JSON shape first) → C → D.

## 7. Gaps and risks
- **Legal**
  - Ofsted text is OGL: short extracts only, attributed and dated, with a link. Never the whole report. No logos.
  - Google, Mumsnet, Locrating and SchoolGuide reviews are prohibited.
  - A "parent rating" only becomes possible once Parent View MI is loaded (OGL, schools with 10 or more responses, not comparable across the 10 Nov 2025 change). Shown as "N responses, x% agree", never as stars.
- **Data**
  - KS2 progress is unpublished for 2023/24–2024/25, and P8 is absent for 2024/25. Label both; never impute.
  - The cohort threshold of 30 will exclude many one-form-entry primaries. Count them with SQL before ship and decide whether KS2 needs a lower threshold.
  - Capacity, FSM, EAL, SEN and destinations were not verified as loaded. Omit them if absent.
  - Only 844 of 11,821 distance rows are publishable.
  - "What the school does well" is not stored (stop heading at `etl_ofsted_reports.py:202`); it could be extracted offline later.
  - The pool covers London state schools only. Independent schools show "Not enough data".
  - Legacy and report-card grades are never combined.
- **SEO**
  - About 2.3k pages carry a thin-content risk. Mitigated by indexing only schools with evidence and by unique numbers and charts on each page.
- **Effort**
  - Admissions rings and a "your home vs last offer" check are deferred; they are a Locrating-beater for v2.

Paths: repo `/Users/vadim/project/close-knit/.claude/worktrees/free-postcode-photos-fc9e7e`. Key existing code:
- `api/area_api/schools.py:125` (`school_history`, not yet exposed by any endpoint)
- `api/area_api/app.py:494`
- `web/src/components/area-schools.tsx:94`
- `web/src/lib/seo.ts:84`