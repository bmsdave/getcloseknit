**School card research: Locrating, legal position and a "Top school" badge**

**1. Locrating features to match or beat**

Locrating (since 2010, about 60k schools and nurseries) gives each school a map-first popup. It shows the catchment indicator, key facts, and links to the Ofsted report and exam results. The full feature list covers:
- inspection history
- KS2, GCSE and A-level results, league tables and side-by-side comparison
- in-depth admissions data, including how far away the last offer went (they say they check every distance by hand)
- feeder and destination schools, class sizes, pupil ethnicity, leaver destinations, SEN profile
- parent reviews: 1–5 stars plus "would you recommend"
- local crime, points of interest and nearby property values

Schools without an Ofsted grade get Locrating's own rating. The formula is not published. Most of this sits behind Premium, which was £41.99 for 3 months. Area pages ("best schools in X") use a fixed radius and are sorted by Ofsted grade and then by name. They are SEO-generated pages.
- https://locrating.com/ · https://www.locrating.com/pricing.aspx · https://www.locrating.com/the-best-schools-in-postcode-cb10%202ya.aspx

**Other competitors**
- **SchoolGuide.co.uk:** its own "Star Ratings" built from official data, league tables ranked by those stars, a compare tool, catchment heat maps and parent reviews. Premium is £19.95 a month. https://www.schoolguide.co.uk/about/school-guide
- **Sunday Times Parent Power:** ranks on attainment only. Secondary score is % of GCSE entries at 9–7 plus % of A-level entries at A*–B; A-levels are reportedly double-weighted, which I could not confirm. It has no progress measure. https://cognito.org/blog/top-100-uk-secondary-schools
- **Compare school performance (DfE):** the official tables, downloadable as CSV from 1991-92. https://www.data.gov.uk/collections/people/compare-school-performance
- **SchoolAtlas:** an OGL reuser to learn from. It warns users that Progress 8 data is out of date. https://www.schoolatlas.co.uk/blog/why-progress-8-scores-disappeared-2025-2026
- **Snobe:** I found nothing on it.

**How we can beat them, for free and with SEO pages:**
- One school card with a percentile against London on every metric and a 3-year trend arrow.
- Report-card area grades shown as chips.
- A Parent View bar chart.
- Admissions shown as rings on our map with a "your home vs last offer distance" check, but only where we hold the council data.
- Plain statements of which data is missing and why (Progress 8, 2020-21).
- A link from each school to the homes and areas around it.

**2. Legal verdicts**

| Source | Verdict |
|---|---|
| Ofsted reports and site content | OGL v3 "except where otherwise stated". Ofsted logos are excluded, and their guidance asks for a hyperlink to the source. Our own short summary of the report's strengths and areas to improve, plus each area grade, is allowed with attribution and a link. Do not reproduce the report wholesale; paraphrase. Label it "summary of Ofsted report, [date]". https://reports.ofsted.gov.uk/copyright · https://gov.uk/guidance/using-ofsted-logos-and-copyright |
| Ofsted Parent View management information | OGL. Released 3 times a year, covering a rolling 365 days. School-level data only for schools with 10 or more responses. The questions changed on 10 Nov 2025, so old and new answers are not comparable. This is our legal source for "what parents think": show % agree for each question and the number of responses. https://www.gov.uk/government/statistical-data-sets/ofsted-parent-view-management-information |
| DfE performance tables, GIAS | Listed as OGL on data.gov.uk catalogue entries; I did not find the service's own licence page. Credit the Department for Education and mark changes we make. |
| Google reviews | Not allowed. Scraping is banned by Google's terms, and the reviews are personal data. The only legal route is the Places API, which limits caching and requires Google's own display. Skip it. |
| Mumsnet | Not allowed. Its terms forbid copying or analysing content with bots or AI. https://www.mumsnet.com/i/terms-of-use-quick-guide |
| Locrating and SchoolGuide reviews | Proprietary; the sites returned 403 to our fetches. Do not scrape. |

So a "parent rating" can only come from Parent View, or later from our own first-party reviews. Never present a Parent View score as a star rating with no basis. Show "N responses, x% would recommend" instead. That question existed in the old survey; I could not confirm it survives in the new one.

**3. Exam metrics and the "Top school" badge**

Context the card has to state:
- KS1→KS2 progress is not published for 2023-24 or 2024-25. It is planned to return for 2025-26.
- Progress 8 cannot be calculated for 2024-25 or 2025-26. It returns with the 2026-27 results, published late 2027; this date comes from SchoolAtlas and is not confirmed by DfE.
- There is no exam data for 2019-20 or 2020-21.
- Since 10 Nov 2025, Ofsted publishes report cards instead of single-word grades. Each area gets one of 5 grades: Exceptional, Strong, Expected, Needs attention, Urgent improvement. The areas are inclusion, curriculum and teaching, achievement, attendance and behaviour, personal development and wellbeing, and leadership and governance, plus early years and sixth form where they apply. Safeguarding is Met or Not met.
- Ofsted says the old grades do not map onto the new ones. Old grades still stand until the school is re-inspected, which will take about 4–5 years across all schools.
- Sources: https://www.gov.uk/government/publications/progress-8-school-performance-measure/secondary-accountability-measures-2025-guidance-for-maintained-secondary-schools-academies-and-free-schools · https://www.gov.uk/government/publications/primary-school-accountability/primary-school-accountability-in-2025-technical-guide · https://www.nga.org.uk/media/qannkjkl/ofsted-reform-summary-20250909.pdf

Headline metrics parents use:
- **Primary:** % meeting the expected standard in reading, writing and maths (national figure 62% in 2025), % at the higher standard, and average scaled scores.
- **Secondary:** Attainment 8, % grade 5+ in English and maths, EBacc entry and average point score, and Progress 8 where it exists.
- **Sixth form:** A-level average point score and grade. A*–B % is what Parent Power uses.

Recommended badge rules:
- Compute everything as a percentile against London state schools of the same phase, from the latest year with data. Show the year on the badge.
- **"Top school":** in the top 10% of London on the phase headline (primary RWM expected %, secondary Attainment 8), **and** in the top 25% on the second measure (primary higher standard %, secondary % grade 5+ in English and maths), **and** a current Ofsted grade of Outstanding or Good, or report-card areas with nothing below Expected and safeguarding Met.
- **Separate small chips:** "Top 10% results", "Exceptional in [area]", "Strong sixth form" (top 25% on A-level average point score), and "Rising" or "Falling" (a 3-year change of at least 5 percentile points).
- **When data is missing:** show "Not enough data" rather than a guessed grade. This applies to cohorts under 11 pupils (suppressed), independent schools, and new schools.
- **Explain it in one line**, for example "Top school: top 10% London KS2 RWM 2025 · Ofsted Good". Link it to a methodology page carrying the OGL credits.

**School summary data**, all from GIAS, the census and the performance tables:
- pupils on roll, capacity and fill %, age range, sixth form yes/no
- pupils per teacher, % FSM, % EAL, % SEN
- absence and persistent absence
- KS2 or KS4 cohort size, and KS4 destinations (% in sustained education or work)

**For SEO**, put the school's name, "Ofsted" and the latest results with their year in the page title and the h1. Add schema.org School markup, and make sure each card can be reached from the area page.