# Full school card: open, compared, one sources menu (owner, 2026-10-16)

This replaces the "collapsed rows" pattern from school-card-compact-spec.md, for the big /school/{urn} page only. The small card for the map side panel comes later.

## Owner's points
1. **Every number needs context.** A bare "646 pupils", "22.4 per teacher" or "£7,246 per pupil" says nothing. Compare each value with **London** and with the school's **borough**, e.g. Ealing.
2. **Catchment must answer "is it close enough to where I'm looking?"** Show the place I came from against the last distance offered.
3. **Parent View is missing for most schools.** Use earlier survey data and label it as earlier.
4. **One menu for all fine print.** Drop every per-section "How this is measured". Put one ☰ menu at the top of the card that holds all sources, licences, definitions and method notes.
5. **No dropdowns by default.** All sections are open and laid out compactly. A disclosure is allowed only for really long detail: Ofsted quotes, yearly result charts, the preference table. That is the exception, not the rule.
6. **No duplicates.** For example, the inspection dots must not appear in the header and again below. Each fact appears once.

## Layout (phone first; desktop uses a 2-column grid of section blocks)
- **Header:**
  - name, type tags (Community · ages 4–11 · Mixed · Ealing · W5 2QT, plus "No sixth form" for secondaries only), Ofsted badge;
  - ☰ sources menu at top right;
  - the Details row is removed, and URN + GIAS link move into the menu.
- **Sections:** always open, ordered by what a parent decides by:
  1. Results → 2. Admissions & catchment (merged) → 3. Inspections & strengths (merged) → 4. Pupils → 5. Parent View → 6. Workforce → 7. Financials → 8. Destinations.
  - Each section is a heading plus its content; there are no chips.
  - Merge sections that answer the same question, so admissions and catchment become "Getting in".

## Comparison graphic: one component, used everywhere
A dot on a range. The track is the London 10th–90th percentile for the same phase (primary or secondary). There are two ticks, **L** (London median) and **E** (borough median, shown only when the borough has 10 or more schools in the same phase), and a dot for this school. To the right sit the value and, in small grey type, "London 34% · Ealing 41%". Colour applies only where a direction is clearly better (absence: lower is better; results: higher is better). Everything else stays neutral.

Use it for:
- **Pupils:** roll (size), FSM, EAL, SEN support, EHCP, absence, persistent absence.
- **Workforce:** pupils per teacher, pupils per adult.
- **Financials:** income per pupil, spend per pupil, staff spend per pupil, reserve per pupil.
  - Compare only within the same accounts type (maintained CFR vs maintained, academy AAR vs academy), and say so in the menu.
- **Admissions:** % of first choices that got in. Results already compare with London.

Medians and percentiles are computed from our own data for the active release, per phase, London and per borough. Nothing is estimated.

## Getting in (admissions + catchment)
- **Headline:** "74% of first-choice families got in · 2026", with the comparison dot.
- **Distance line:**
  - The axis runs from 0 to max(last offered, your distance).
  - Bars or markers show the last distance offered per year.
  - A "You" marker shows the straight-line distance from where the user came from: `?from=` area centre today, a home if the URL carries one.
  - A verdict word on the "You" marker: "inside last year's distance" or "outside". Label it "approx.: from the centre of Pitshanger, not your door".
  - With no origin, show the distances only.
- **Preferences:** the 1st/2nd/3rd table sits behind "By preference" (allowed exception).

## Parent View
Show the newest survey with 10 or more responses. If the post–Nov 2025 survey has none, show the **earlier survey**, labelled "Earlier survey (before Nov 2025) · as at <date> · N responses". Never mix the old and new surveys in one chart.

## Must not change
- No invented numbers.
- 44px tap targets.
- No horizontal scroll at 375px.
- Both themes.
- Every value keeps its year (in the section heading, once).
