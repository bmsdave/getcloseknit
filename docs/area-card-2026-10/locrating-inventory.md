# Locrating school card: what it shows (inspected 2026-10-15)

Example: Vicar's Green Primary (URN 101916, Ealing), logged-in free account.
"Locked" means the row is shown but the value needs a paid membership.

## Overview (one row per section, chip on the right)

| Row | Example chip | Locked? |
|---|---|---|
| Details | Primary | no |
| Pupils | Mixed · 439 pupils | no |
| Inspections | Outstanding | no |
| Strengths & weaknesses | 22 / 1 (AI summary) | no |
| Primary results | Top N% | **yes** |
| Ofsted reviews (Parent View) | 81% happy | no |
| Locrating reviews | user reviews | out of scope |
| Admissions | % oversubscribed | **yes** |
| Catchment | last distance offered | **yes** |
| Destination schools | ~11 schools | partly |
| Workforce | 22 teachers | no |
| Financials | Reserves in surplus | no |

## Details (when a row is opened)

- **Details:** phase, type, age range, gender, nursery, religious character, headteacher, address, phone, LA, URN, GIAS link.
- **Pupils (census Jan 2026):**
  - Headline figures: total, % of capacity, boy/girl split, pupils per teacher (2026), FSM %, EAL %, persistent absence % (2024), SEN support %.
  - Pupil total over time.
  - Class sizes (KS1/KS2) and school-day hours per week.
  - Cohort size per year group by gender.
  - Ethnicity mix.
  - Suspensions and permanent exclusions (2025).
- **Inspections:**
  - A dot chart of rating over time.
  - Each visit: date, type, report link, overall grade and sub-judgements.
  - Post-2024 visits get a derived "Locrating rating".
- **Strengths & weaknesses:** AI bullets taken from the latest report.
  - We do not use AI here. Counts come from graded areas plus Ofsted's own "to improve" points.
- **Primary results:**
  - Line: "Ranked X of 14,749 schools (in top N%)". The year shown changes N; 14,899 appears for another year.
  - Rank-over-time chart, 2018–2025.
  - Tie-break: sort by % meeting expected RWM, then by % at the higher standard.
  - Each measure is shown for school / LA / England: RWM expected and higher, scaled scores, progress (to 2023).
- **Parent View:**
  - Headline: % happy.
  - 12 questions, each with "based on N responses up to <date>".
  - Note on the 10 Nov 2025 survey change.
- **Admissions:**
  - % oversubscribed, 2020–2026.
  - On-time applications as 1st, 2nd and 3rd preference, and from another LA.
  - Offers by preference.
- **Catchment:**
  - Last distance offered, or links to council documents.
  - A map of where pupils live, from the census. Not open data, so we skip it.
- **Destination schools:** % of Y6 leavers going to each secondary, per year, plus grammar %.
  - No open source exists, so we never build it.
  - For secondaries we show KS4/16–18 destination measures instead.
- **Workforce:**
  - Teachers FTE and TAs FTE.
  - Pupils per teacher, and per teacher + TA.
  - Leadership FTE, support and auxiliary staff, headcount, total workforce.
- **Financials:**
  - Revenue reserve as £ and £ per pupil.
  - In-year balance.
  - Income per pupil: grants and self-generated.
  - Spend per pupil: staff and premises.

## For us

- Every row except Destination schools (primary) and the pupil-home map has an open OGL source. See school-data-sources.md.
- Everything is shown openly, with no locks.
- National rank uses the same tie-break as Locrating. It always shows N and the year.
