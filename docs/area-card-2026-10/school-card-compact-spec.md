# School card: compact, visual pass (owner request 2026-10-16)

Owner: "make the rows more informative: charts and details visible, long explanations hidden; more compact and easier to take in."
Review based on screenshots of 101912 (primary), 138051 (secondary) and 100025 (Parent View), on phone and desktop. The phone page is about 8,000–9,000px tall with every row open, and roughly a third of that is explanation text.

## Rules for the whole card
1. **Visible = numbers + graphics.** Every definition, method note, source credit and licence line moves into one small disclosure per section, "ⓘ How this is measured", closed by default and placed at the end of the section. One component, reused in all 11 sections. Source links stay inside it, so attribution is still on the page.
2. **The year appears once per section**, in the row subtitle. Do not repeat "2024/25" on every bar or tile.
3. **Collapsed rows carry a mini-graphic next to the chip.** Each row should be useful without opening it. Use small inline SVGs (about 56×16), reusing MiniLine / dots / bars:

   | Row | Chip | Mini-graphic |
   |---|---|---|
   | Pupils | 646 | girls/boys split bar |
   | Inspections | Good | one dot per inspection, coloured by grade, oldest → newest |
   | Strengths & weaknesses | 👍5 👎0 | — |
   | Results | Top 5% | rank-by-year sparkline |
   | Parent View | 81% happy | — |
   | Admissions | 74% got in | sparkline |
   | Catchment | 1.3 km | sparkline of the last distance offered |
   | Workforce | 22 pupils/teacher | — |
   | Financials | +£181k reserve | — |
   | Destinations | 22% → Ark Acton | — |

4. **Rows with no data** (for example Parent View) show a muted chip "No data". Opening the row shows one muted line, never a bold paragraph.
5. **Round numbers for reading:** FTE to 1 decimal (12.2, not 12.21); money as £181k / £7.2k in chips; full figures in the body.
6. **Desktop (≥1024px):** section bodies use a 2-column grid where the content allows. No full-width bars across 1,200px; cap bar tracks at about 320px.

## Per section
- **Header:** "Rising (+7.7 pts since 2018/19)" does not say what rose. Make it "England rank: top 23% → top 5% since 2018/19", or drop it, since the Results row now shows the trend.
- **Details:** 7 stacked label/value pairs take about 300px. Show one wrapped line of chips: Community · ages 4–11 · Mixed · No sixth form · Ealing · W5 2QT · URN 101912. Keep the GIAS link inside the ⓘ disclosure.
- **Pupils:**
  - Keep the 4 tiles, but make them smaller (value + short label).
  - Keep the girls/boys bar.
  - Bar rows stay, with no year per row.
- **Inspections:** replace the vertical list with a horizontal timeline: coloured dots with year labels, the latest grade and date in bold, and each dot linking to its report. Drop the "Good or better" legend.
- **Strengths & weaknesses:**
  - Keep the two lists (strong / weak areas).
  - Put "What Ofsted said" quotes behind a "Read what Ofsted said (5)" disclosure.
  - Move the grading-rule paragraph into ⓘ.
- **Results** (the longest section):
  1. Rank line: "Ranked 638 of 15,057 · top 5% · 2024/25", with a compact rank-by-year chart (about 90px tall).
  2. "Against London": one compact row per measure (value · /10 dots · London median · trend arrow), not 4 tall tiles with percentile sliders.
  3. The 4 KS2/KS4 yearly charts become 2×2 small multiples (about 120px tall each) behind "Show by year". They stay open on desktop.
  4. The "progress not published" bullets become one muted line inside ⓘ.
- **Parent View:** chip "81% happy". The body shows one bar per question (% agree) and the response count; the survey-change note goes into ⓘ.
- **Admissions:** keep the current layout. Drop the repeated "Reception 2026" heading when there is only one entry point. The definition sentence goes into ⓘ.
- **Catchment:** keep the bars. The source and "not a catchment" text go into ⓘ, with the council source link visible as a small "Source: Ealing Council" under the bars.
- **Workforce:** replace the 7 tiles with:
  - a headline "22.4 pupils per teacher · 15.1 per adult";
  - one stacked bar of the workforce (teachers / TAs / leadership / other support), with a legend showing FTE values to 1 decimal;
  - definitions in ⓘ.
- **Financials:**
  - Two chips: reserve (+£180,575 · £280/pupil) and in-year balance.
  - Income and spend bars side by side on desktop, stacked on phone.
  - The two fine-print paragraphs move into ⓘ.
- **Destinations:**
  - The school name goes on its own line above the bar and %, so names no longer wrap to 3 lines.
  - The grammar line stays.
  - Source and definition go into ⓘ.
- **Footer:** the empty "Sources and method" box. Either put content in it, or merge it with the ⓘ sources and remove it.

## Must not change
- No number is removed. Everything is still on the page, just inside ⓘ where noted.
- No invented values.
- 44px tap targets.
- No horizontal scroll at 375px.
- Both themes.
- Existing test IDs where possible.
