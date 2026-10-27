# User feedback: quick votes and a feedback form

Date: 2026-10-14. Status: approved design, ready for an implementation plan.

## Goal

Tell us what people like and dislike, with as little effort from them as possible:

1. **Quick votes** (👍/👎) where people read evidence and get search results.
2. **A feedback form**: a 1–5 star rating, reasons as chips and free text.
3. **A Grafana dashboard** that shows both next to the product analytics.

Success: a person can vote with one tap and send a review in under 20 seconds; we can see
which area-page sections and which shortlists people find useful, and why not.

## Decisions (from the user)

- Votes on **every area-page card**, not once per page.
- Search = the **Find my area shortlist** (not the place search box, which `search_empty` covers,
  and not the property page, for now).
- Form entry: a permanent **Feedback** link plus a **gentle prompt after the first action**.
- **Fully anonymous**: no email field, no visitor id. Contact details typed into text are removed.

## What good feedback UIs do (and we copy)

- A vote is one tap and is saved at once. After 👎, ask *why* with a few one-tap reasons and an
  optional line of text; skipping loses nothing (Google, ChatGPT, help-centre "Was this useful?").
- Overall satisfaction is CSAT 1–5, not NPS (NPS needs a large audience).
- Reason chips **follow the rating**: 4–5 stars ask what worked, 1–3 ask what got in the way
  (Uber, Airbnb, Intercom). One screen gives a score and its reasons.
- Free text is always there and always optional; a required box makes people leave.
- Ask after a success, rarely, and never on arrival.

## Storage: one table, its own endpoint

Feedback is something a person chose to send, so it is **not** product analytics: it is stored
even with "Analytics off", GPC or DNT, and it carries **no visitor or session id**. Free text stays
out of the 180-day `product_event` table. (Rejected: votes as `product_event`, which "Analytics off"
would drop; everything in `product_event`, which would mix free text into analytics.)

### Migration `deploy/migrations/053-site-feedback.sql`

```sql
CREATE TABLE IF NOT EXISTS site_feedback (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_id uuid NOT NULL UNIQUE,            -- made by the browser; lets it change a vote or add reasons
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    kind text NOT NULL CHECK (kind IN ('vote', 'review')),
    surface text NOT NULL CHECK (surface ~ '^[a-z_]{2,30}$'),   -- area_card | shortlist | site
    target text CHECK (target IS NULL OR target ~ '^[a-z_]{2,30}$'), -- card id, market
    area text CHECK (area IS NULL OR char_length(area) <= 40),  -- area id an area_card vote is about
    vote smallint CHECK (vote IN (-1, 1)),
    rating smallint CHECK (rating BETWEEN 1 AND 5),
    tags text[] NOT NULL DEFAULT '{}',
    message text CHECK (message IS NULL OR char_length(message) <= 2000),
    path text CHECK (path IS NULL OR char_length(path) <= 120),  -- pagePath() template
    device text CHECK (device IS NULL OR device IN ('mobile', 'tablet', 'desktop')),
    CHECK ((kind = 'vote' AND vote IS NOT NULL AND rating IS NULL)
        OR (kind = 'review' AND rating IS NOT NULL AND vote IS NULL))
);
CREATE INDEX IF NOT EXISTS site_feedback_created_at_idx ON site_feedback (created_at);
GRANT SELECT ON site_feedback TO close_knit_analytics;
```

Kept 365 days like `mcp_feedback`. It is production-only like `mcp_feedback`: add it to
`PRODUCTION_ONLY_TABLES` (db-restore.sh), the backup's `--table` list (backup-prod-data.sh),
`--exclude-table-data` (db-snapshot.sh), `grafana-role.sh`'s message and the test lists
(`deploy/tests/test_grafana.py`, `test_restore_filter.py`).

### API: `api/area_api/site_feedback.py` and `POST /api/v1/feedback`

- Payload: `{client_id, kind, surface, target?, area?, vote?, rating?, tags?, message?, path?, device?}`.
- Validation against allowlists in the module (unknown tags are dropped; an unknown surface/target
  or a vote/rating that breaks the rules → 422):

| surface | target | 👎 / low-rating tags | 👍 / high-rating tags |
|---|---|---|---|
| `area_card` | `price sales living schools around environment planning council home` | `hard_to_understand looks_wrong missing_info out_of_date` | — |
| `shortlist` | `buy rent` | `too_expensive too_far wrong_areas too_few unclear_why` | — |
| `site` (review) | — | `hard_to_use missing_data wrong_data not_covered slow broken` | `easy_to_use useful_data found_areas looks_good fast` |

- `message` goes through `feedback.scrub()` (emails and phone numbers removed), is trimmed, and an
  empty string becomes NULL.
- **Upsert by `client_id`**: `INSERT … ON CONFLICT (client_id) DO UPDATE SET vote, rating, tags,
  message, updated_at = now()`. `kind`, `surface`, `target` and `area` cannot change on update
  (the conflict update leaves them out). Changing a vote, then adding reasons, is one row.
- Each insert purges rows older than 365 days (as `feedback.store` does).
- Crawlers (`usage.is_bot`) are ignored. The existing `RateLimitMiddleware` covers the route.
- Returns `204`. A database error returns `503` so the form can say "Couldn't send, try again";
  a vote failure is silent.
- CLI: `python -m area_api.site_feedback list [--days N] [--json] | purge`. `deploy/tools/feedback.sh`
  gains a `web` subcommand: `tools/feedback.sh web list`.

### Next.js: `web/src/app/api/v1/feedback/route.ts`

Same shape as `api/v1/usage/route.ts`: passes the body (< 8 KB) and user agent to the API and returns
its status. In demo mode (no evidence service) returns 204 and keeps nothing.

## Browser

### `web/src/lib/feedback.ts`

- `sendFeedback(payload): Promise<boolean>` — POST with `keepalive`, adds `path` (`pagePath`) and
  `device` (`deviceClass` from `lib/usage.ts`).
- Votes remembered in localStorage `close-knit.votes.v1`: `{ "<surface>:<target>:<scope>": {id, vote} }` (scope = the area id for a card, the ranking hash for a shortlist),
  capped at 200 entries (oldest dropped), so a card shows the vote already given and a second tap
  updates the same `client_id`. All storage access is in try/catch; without storage a vote still sends.
- The prompt's memory in `close-knit.feedback-prompt.v1`: `{ nextAt: <epoch ms> }`.

### `QuickVote` (`web/src/components/quick-vote.tsx`)

`<QuickVote surface target area? question reasons />`.

- A small row: question text, 👍 and 👎 as buttons with `aria-pressed` and labels "Useful" /
  "Not useful", 44px touch targets.
- 👍 → saved, the row reads "Thanks".
- 👎 → saved, then the reason chips (multi-select toggles), a one-line text input ("Anything else?",
  max 500) and **Send**. Send updates the same row and reads "Thanks — this helps". Leaving it
  is fine: the 👎 is already stored.
- Tapping the other thumb changes the vote; tapping the same one again does nothing.

Placement:

- **Area page**: inside `AreaCard` (`area-full-page.tsx`), at the end of the card body, before the
  sources fold. Question "Was this useful?". `area` = the page's area id. Reasons: *Hard to
  understand · Looks wrong · Missing what I need · Out of date*.
- **Shortlist**: under the ranked list in `PersonalMatchPanel`, shown when the ranking has results.
  Question "Are these areas a good fit?". `target` = the market. Reasons: *Too expensive · Too far
  from my places · Areas I wouldn't consider · Too few results · Not sure why these*. A new search
  (a new `match_run`) clears the shown vote so each ranking can be rated; its key includes a hash of
  the ranked area ids.

### Feedback form (`web/src/components/feedback-form.tsx`)

Used on the `/feedback` page and in a dialog opened from the prompt.

1. "How's Close Knit so far?" — five star buttons in a radiogroup with labels *Terrible, Poor,
   OK, Good, Great*; arrow keys move between them.
2. After a rating, chips appear: 4–5 → "What worked well?" *Easy to use · Useful data · Found
   good areas · Looks good · Fast*; 1–3 → "What got in the way?" *Hard to use · Missing data ·
   Wrong data · My area isn't covered · Slow · Something broke*. Changing the rating across the
   3/4 line clears the chips.
3. A text area, placeholder by rating: "What would make it better?" / "What did you like most?";
   up to 2000 characters with a counter near the limit. Under it: "Please don't include names or
   contact details. We can't reply — this form is anonymous."
4. **Send** is enabled once a rating is chosen. Success → "Thank you!" and a link back. Failure →
   inline error, text kept.

Sent as `kind=review, surface=site`, with a fresh `client_id` per submission.

### Entry points

- **Feedback** link in the top-bar menu (`top-bar-menu.tsx`) and the site footer → `/feedback`.
- **Prompt** (`feedback-prompt.tsx`, mounted in `layout.tsx`): after the first portal click,
  watch opening or brief share in a page session, a small card at the bottom corner reads "How's
  Close Knit so far?" with the five stars and a close button. A star opens the form dialog with
  that rating. Close → not again for 30 days; a sent review → 90 days. Never on first page view,
  never while another dialog is open. The trigger: `track()` in `lib/usage.ts` dispatches a
  `close-knit:acted` window event for `portal_click`, `watch_open` and `brief_share` **before** its
  analytics-mode check, so the prompt works with analytics off too. Shown at most once per page
  session.

Styling follows the site's tokens (light and dark); no new colours.

## Privacy

`/privacy` gains a "Feedback" paragraph: what is stored (vote or rating, chosen reasons, your text,
the kind of page and device type), that it is not linked to the analytics id, kept 12 months, and
that "Analytics off" does not stop feedback you choose to send. `docs/product-analytics.md` links
to this spec's dashboard section.

## Grafana: "Close Knit · Feedback"

A third dashboard in `deploy/tools/grafana_dashboards.py` (`feedback()`), rendered to
`deploy/grafana/dashboards/feedback.json`:

- Stats: reviews, average rating, % 4–5 stars, votes, % 👍 (selected period).
- Rating over time (weekly average and count) and the 1–5 distribution.
- Area cards: per card, votes and % 👍 (bar gauge), sorted worst first.
- Shortlist: % 👍 per week, by market.
- Top reasons: tag counts by surface for 👎 and low ratings; what worked for 4–5.
- Areas with the most 👎 (area, card, count).
- Latest comments: time, surface/target, rating or vote, tags, message, path (table, newest first).

## Testing

- `api/tests/test_site_feedback.py`: validation (allowlists, kind rules, tag filtering, length),
  scrubbing, upsert keeps kind/surface, purge, endpoint 204/422/503, bots ignored.
- `deploy/tests/test_grafana.py`: the new dashboard renders and only reads usage tables.
- `web/src/lib/feedback.test.ts`: vote memory (key, cap, no storage), prompt timing.
- Playwright `web/e2e/feedback.spec.ts`: vote 👎 on an area card and send reasons (request body
  checked via route interception); the `/feedback` form; the prompt after a portal click and its
  30-day dismissal.
- Then the full API, web unit and e2e suites once.

## Out of scope

Votes on the place search box and the property page; replying to people; NPS; screenshots or
attachments; showing vote counts to readers.
