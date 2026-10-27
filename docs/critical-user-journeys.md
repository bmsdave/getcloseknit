# Critical user journeys

The journeys Close Knit exists for, what success means for each one, and how it is measured.
They are drawn as funnels on Grafana's **Close Knit · Journeys** dashboard
(`deploy/tools/grafana_dashboards.py` → `journeys()`). Events and privacy rules are in
[product-analytics.md](product-analytics.md).

Funnels are **strict**: each step counts the people who did that step *and every step before it*
in the chosen period. They count people (anonymous browser ids) or, for Claude, conversations,
never clicks. Order inside the period is not enforced, because a reader can come back on another
day and continue. Each funnel also shows the share of the start and the share of the step before,
which shows exactly where people drop off.

## 1. Find my area: the main happy path

A household that doesn't know where to live answers a few questions, gets a ranked shortlist,
looks at an area and goes to the homes there.

| Step | Event |
|---|---|
| 1 opened Find my area | `wizard_open` (`from`: map or area, `first`: nothing asked before) |
| 2 answered the basics | `wizard_review` (budget, bedrooms and places passed validation) |
| 3 asked for areas | `wizard_show` (`example`: the ready-made search) |
| 4 got a shortlist | `match_run` with `results` > 0 |
| 5 opened an area from it | `area_open` |
| 6 **acted ★** | `portal_click`, `watch_open` or `brief_share` |

**Success:** step 6. **Warning signs:** people stopping between 1 and 2 (the questions are too
hard), "Opened Find my area but never asked", and "Shortlists with no area" (the search was too strict).
**Quality:** the shortlist's thumbs-up share and its thumbs-down reasons, on the Feedback dashboard.

## 2. Look up a place

Someone who already has a place in mind searches for it, reads the area page and opens the listings.

| Step | Event |
|---|---|
| 1 searched for a place | `search` with a `kind` other than home |
| 2 opened an area or postcode page | `page_view` on `/area/…` or `/postcode/…` |
| 3 clicked out to a portal | `portal_click` |

**Success:** step 3. Searches that found nothing (`search_empty`) are where this journey breaks
first; they are listed on the Product dashboard.

## 3. Check a home

Someone weighing up a particular home (their own, or one they saw listed) checks its record and the
portals.

| Step | Event |
|---|---|
| 1 opened a home | `search` with kind home, or `page_view` on `/property/:id` |
| 2 followed its portal links | `portal_click` with `from` home (Rightmove sold prices, Zoopla and OnTheMarket listings) |

## 4. Claude: a conversation from shortlist to listings

The same happy path inside Claude, counted per MCP conversation (a one-way session tag).

| Step | Event |
|---|---|
| 1 used a tool | any `tool_call` |
| 2 shortlisted areas | `find_areas`, `match_areas`, `find_similar_areas` or `open_shared_search` that worked |
| 3 looked closer at an area | `get_area_overview` |
| 4 got listing links | `get_listing_search_links` |
| 5 **someone opened a listing ★** | `portal_click` through `/go` with that conversation's tag |

## 5. Share and come back

A search is a household decision: people share it, and they come back over weeks.

| Line | Event |
|---|---|
| shared a link | `brief_share` |
| arrived through a shared link | `page_view` with `shared` (search, shortlist or brief), only when the link was opened from outside the site; the link's contents are never sent |
| …and then acted ★ | the same people with `portal_click`, `watch_open` or `brief_share` |
| came back on another day | people active on two or more days in the period |

This panel is not a strict funnel: each line is a share of everyone active in the period.

## Time to value and entry channels

- **New people who found an area or home**, and the **median time to the first area**: from a new
  person's first page to their first area, home, postcode page or shortlist.
- **New people who clicked out**, and the **median time to the first click-out**. Minutes mean one
  sitting; days mean the person came back.
- **By entry channel**: each person's channel is where their very first visit came from (`invite`, a
  `utm_source`, `claude`, `google`, or direct). For each channel the table shows who searched, found,
  clicked out and acted, so you can see which channel brings people who get value and where each one
  drops off.

## Changing a journey

1. Update this file.
2. Add any missing event in `web/src/lib/usage.ts` (the `UsageName` type), where it happens, and in
   `WEB_EVENTS` in `api/area_api/usage.py` with its props, plus a test on both sides.
3. Change `journeys()` in `deploy/tools/grafana_dashboards.py`, run it to rewrite the JSON, then
   `python -m unittest tests.test_grafana` from `deploy/`.
4. Ship. The dashboards update when Grafana restarts.
