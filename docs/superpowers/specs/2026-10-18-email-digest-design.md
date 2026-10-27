# Email digest: a weekly email about what you saved

Date: 2026-10-18. Status: approved design and plan ([plan](../plans/2026-10-18-email-digest.md)).
**Build paused by the owner on 2026-10-18:** no audience to email while the site is private, and
the extension is the return hook for now. Revisit when, after going public, under 20% of people who
saved something come back within a week.

## Goal

Give people a reason to come back. Close Knit has no return channel today: saved schools and
areas live only in the browser, and the site collects no emails. Growth targets DAU and engaged
time ([growth plan](../../growth-2026-10/README.md)), so the owner chose an opt-in email digest
over web push (iPhone push needs a home-screen install).

Success: a person subscribes from Saved in under 20 seconds. They get an email only in a week
when something they saved changed or a school date is near. Every link in it opens Close Knit,
even while the site is private. We can count digest visits and returns by `utm_source=digest`.

## Decisions (from the owner)

- **Weekly, but skip empty weeks.** No changes and no reminders means no email.
- **Contents in v1:** schools (new Ofsted inspections and admission date reminders), and for
  areas: new sales, crime trend, wildlife. Saved places are not in v1.
- **Explicit consent:** double opt-in and one-click unsubscribe. This replaces the rule "the site
  collects no emails".
- **The site stays private for now.** Digest links must get the reader past the shared login.
- **SMTP provider: Brevo.** The owner creates the account and sets SPF, DKIM and DMARC for
  getcloseknit.com. The code only speaks SMTP.
- **Approach 1A, 2A, 3A:**
  - saved items: a snapshot plus auto-sync;
  - links: a `/d/<token>` path past the login;
  - content: a diff against what we sent last time, run weekly from cron.
- **No accounts and no login.** The digest token is the lightweight identity: the "My saved"
  link restores the list on another device.

## Non-goals

- Accounts, passwords and a settings page beyond unsubscribe.
- Open or click tracking pixels.
- Saved places, listings alerts, rotation dates for doctors, and monthly sector reports for
  landlords. All of these are later, built on the same tables.
- Bounce webhooks. In v1 they are handled by hand in Brevo plus `purge --email`.

## Hard rules

- **Never join the email to the analytics `visitor_id`.** No `visitor_id` column, and no event
  carries the email or the token ([product-analytics.md](../../product-analytics.md)).
- **Tokens are signed, not stored.** A token is `<subscriber id>.<sig>`, where
  `sig = base64url(HMAC-SHA256(CLOSE_KNIT_DIGEST_SECRET, "<id>:<token_version>"))[:43]`. The
  database holds no secret. The weekly send can rebuild every link, and deleting the row on
  unsubscribe kills every link. Tokens live only in email links and the subscriber's localStorage.
- **No email address appears in logs, events or error messages.**
- **Copy promises nothing about schools.** It reports what was published, and never says "you
  will get in" or "a chance". It keeps the existing historicalAssessment wording.
- **Census figures and per-home valuations never appear in the digest.**

## Units

| Unit | What it does | Depends on |
|---|---|---|
| `deploy/migrations/066-digest.sql` | tables below | — |
| `api/area_api/digest_links.py` | sign and check tokens, the safe `to` target, absolute links with `utm_source=digest` (pure) | `CLOSE_KNIT_DIGEST_SECRET`, `CLOSE_KNIT_PUBLIC_URL` |
| `api/area_api/digest_store.py` | subscribe, confirm, replace items, unsubscribe, purge | Postgres |
| `api/area_api/digest_facts.py` | builds the facts for one item and diffs them against `last_facts` (pure functions plus SQL readers) | release tables |
| `api/area_api/digest_calendar.py` | school admission reminders for a given date (pure) | — |
| `api/area_api/digest_email.py` | renders the subject, text and HTML from the diffs and reminders (pure) | — |
| `api/area_api/digest.py` | CLI `send` / `preview` / `purge`; orchestrates and sends through SMTP | the above, `notify.py` settings |
| `api/area_api/app.py` routes | `/api/v1/digest/*`, `/d/<token>…` | `digest_store`, `invites` |
| Caddy | lets `/d/*` past the login; keeps it out of the access log | API |
| `web/src/lib/digest.ts` | token in localStorage, subscribe call, debounced item sync, restore from `#digest=` | `saved-items.ts`, `compare-selection.ts` |
| `web/src/components/digest-signup.tsx` | the block in Saved | `digest.ts` |

## Data model (`066-digest.sql`)

```sql
CREATE TABLE digest_subscriber (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,                 -- stored lower-cased and trimmed
  token_version smallint NOT NULL DEFAULT 1, -- part of the signed token; bump to revoke links
  status text NOT NULL CHECK (status IN ('pending', 'active')),
  consent_version text NOT NULL,       -- id of the consent wording shown
  consented_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX digest_subscriber_email ON digest_subscriber (email);

CREATE TABLE digest_item (
  subscriber_id uuid NOT NULL REFERENCES digest_subscriber(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('school', 'area')),
  item_id text NOT NULL,               -- school URN or area GeographyId
  name text NOT NULL,
  last_facts jsonb,                    -- what the last email reported; NULL until the first send
  PRIMARY KEY (subscriber_id, kind, item_id)
);

CREATE TABLE digest_send_log (
  id bigserial PRIMARY KEY,
  subscriber_id uuid REFERENCES digest_subscriber(id) ON DELETE SET NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('confirm', 'digest', 'manage')),
  items integer NOT NULL DEFAULT 0,
  reminders text[] NOT NULL DEFAULT '{}' -- reminder ids sent, so each one goes once
);
```

Limits: at most 30 items per subscriber (schools plus areas), which is more than Saved and
Compare hold today. An unsubscribe deletes the subscriber row, and its items cascade.

Retention:
- `pending` rows older than 7 days are deleted;
- `digest_send_log` rows older than 90 days are deleted;
- active subscribers are kept until they unsubscribe. /privacy says so.

## API

All routes are rate-limited (a new `digest` class in `ratelimit.py`). No route echoes an email
back or says whether one is subscribed.

- `POST /api/v1/digest/subscribe` with `{email, consent: true, consentVersion, items: [{kind, id, name}]}`.
  - Validates the email (syntax and length only), `consent === true` and items (≤30, known kinds).
  - **New email:** inserts `pending` with a new token and items, then sends the confirm email.
  - **`pending` email:** bumps `token_version` (old confirm links stop working), replaces the
    items and re-sends the confirm email.
  - **`active` email:** sends a "manage" email with the "My saved" link and changes nothing.
  - The confirm email has one "Confirm" button (`/d/<token>?to=/?saved=1`), which also restores
    Saved. The manage email has the same link labelled "My saved".
  - Always answers `202` with an empty body. If SMTP is not configured or the send fails, it
    answers `503`, and a new row is rolled back.
  - Rate: 5 per hour per IP.
- `PUT /api/v1/digest/items` with header `X-Digest-Token` and body `{items}`. Replaces the items
  of an existing subscriber (pending or active) and keeps `last_facts` for items that stay.
  Answers `204`, or `404` when the token is unknown. Rate: 60 per hour.
- `GET /api/v1/digest/items` with header `X-Digest-Token`. Returns `{items}` for restore, or
  `404` when the token is unknown. Rate: 60 per hour.
- `GET /d/<token>?to=<path>`:
  1. Checks the signature and loads the subscriber by id with the same `token_version`. If the
     token is unknown, it shows a neutral "This link has expired" page with a link to the home
     page, and sets no cookie.
  2. If the row is `pending`, it becomes `active` (`confirmed_at = now()`). This is the double
     opt-in.
  3. While `CLOSE_KNIT_ACCESS=private` and the invite secret is set, it sets the invite cookie
     (`invites.cookie_header`) without spending an invite use.
  4. It redirects (`303`) to `to`. `to` must start with a single `/` and must not contain `//`,
     a backslash or a scheme; otherwise it falls back to `/`. `utm_source=digest` is added when
     missing. When `to` is `/?saved=1`, the redirect carries `#digest=<token>` so the browser can
     restore and keep the token.
- `GET /d/<token>/unsubscribe` shows a one-button page. `POST /d/<token>/unsubscribe` deletes
  the subscriber and answers with a "You're unsubscribed" page. It also accepts the RFC 8058
  one-click body `List-Unsubscribe=One-Click`.

## Caddy

In `access-private.caddy`, `handle /d/*` proxies to `api:8080` before the login, as
`/access/*` already does. `access-public.caddy` proxies it the same way. The `/d/*` requests are
excluded from the access log, or logged with the path cut to `/d/…`, so tokens never land in
logs.

## Web

- **Signup block** in the Saved dock, shown when Saved has at least one school or area and no
  token is stored:
  - an email field;
  - one consent checkbox: "Email me weekly when something I saved changes. Unsubscribe in one
    click.", where the wording id is `consentVersion` (`digest-consent-v1`);
  - a "Subscribe" button.

  After `202` it shows "Check your inbox to confirm", and after `503` it shows "Email is off
  right now". It is terse, a single block with no new heavy components.
- **Subscribed state:** "Weekly email on" and an "Unsubscribe" link. The token is in
  localStorage `close-knit.digest.v1`.
- **Sync:** `digest.ts` listens to the saved-items and compare change events. When a token is
  stored, it sends `PUT /api/v1/digest/items` 2 s after the last change. A `404` drops the stored
  token.
- **Restore:** on load with `#digest=<token>`, it fetches the items, merges them into Saved and
  Compare (union, within the existing caps), stores the token and clears the fragment with
  `history.replaceState`.
- **Copy updates:**
  - `watch-listings.tsx` "We don't collect listings or emails" becomes "We don't collect
    listings. Email only if you subscribe to the digest.";
  - /privacy gets an "Email digest" section: what is stored, Brevo as processor, retention,
    unsubscribe, and no tracking pixels.

## Digest builder

`python -m area_api.digest send` runs weekly from the host crontab through
`deploy/tools/digest.sh send`.

1. It selects `active` subscribers with `last_sent_at` empty or older than 6 days, oldest first,
   at most `CLOSE_KNIT_DIGEST_MAX_PER_RUN` (default 250, Brevo's free daily cap). The rest wait
   for the next run.
2. For each item it builds the facts from the active release:
   - **Area sales:** `count` and `median` price of `area_recent_sale` rows with `completion_date`
     after the previous facts' `through` date (on the first send, the last 30 days). Also
     `through`, the latest completion date seen.
   - **Area crime:** the release holds 12 monthly periods (for example 2025-09 to 2026-08). The
     fact is the direction of the latest 3 months against the 3 before (`up`, `down` or `flat`,
     with a ±10% band) and the latest period. It is reported only when the latest period moved
     on and the direction differs from `last_facts`.
   - **Area wildlife:** the set of species in `area_wildlife` for the area. Species that are new
     since `last_facts` are reported by name only, at area level, never with a point or a
     location.
   - **School:** the latest `school_inspection.publication_date` and the headline the school
     card already shows for it (a report card or a grade, whichever is stored). A newer one than
     `last_facts` is reported.
3. Reminders come from `digest_calendar.reminders_for(today)` for subscribers with at least one
   saved school:

   | id | date | text |
   |---|---|---|
   | `secondary-deadline-YYYY` | 31 Oct | Secondary school applications close |
   | `reception-deadline-YYYY` | 15 Jan | Reception and junior applications close |
   | `secondary-offers-YYYY` | 1 Mar, or the next working day | Secondary offers out |
   | `primary-offers-YYYY` | 16 Apr, or the next working day | Primary offers out |

   A reminder is due from 14 days before its date until the date. Each id goes once per
   subscriber, checked against `digest_send_log.reminders`.
4. **No diffs and no reminders means skip.** Nothing is sent and nothing is written.
5. **The email:**
   - The subject counts what is in it, for example "3 updates on what you saved".
   - The body has one line per changed item, then reminders, then a "My saved" button
     (`/d/<token>?to=/?saved=1`).
   - The footer has the sources (HM Land Registry, police.uk, Ofsted, GBIF) and the unsubscribe
     link.
   - It is plain text plus a simple HTML part in the house look: snow-white, yarn accent, no
     olive. It has no images that track opening.
   - Every item link goes through `/d/<token>?to=/area/…` or `/school/…`.
6. It sends through the SMTP settings in `notify.py` (Brevo) with `From:
   CLOSE_KNIT_DIGEST_FROM` and the headers `List-Unsubscribe: <https://…/d/<token>/unsubscribe>`
   and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
7. On success, in one transaction, it updates `last_facts` for the items it reported (and for
   items seen for the first time), `last_sent_at`, and a `digest_send_log` row. On an SMTP
   error it changes nothing, so the next run retries.

`preview <email>` prints what would be sent and changes nothing. `purge` deletes old pending
rows and old log rows. `purge --email <address>` deletes one subscriber, for bounces and
requests.

## Configuration

New variables in `deploy/.env.example`:
- `CLOSE_KNIT_DIGEST_FROM`, for example `Close Knit <digest@getcloseknit.com>`;
- `CLOSE_KNIT_DIGEST_MAX_PER_RUN`;
- `CLOSE_KNIT_DIGEST_SECRET`, 32+ random characters. Without it the digest is off, as without
  SMTP.

Absolute links use the existing `CLOSE_KNIT_PUBLIC_URL`.

The digest reuses `CLOSE_KNIT_SMTP_*`. Without SMTP the digest is off: subscribe answers `503`,
and `send` exits with a clear message. Preflight reports "digest off: no SMTP" as a warning,
not a failure. RELEASE-CHECKLIST gets the crontab line and the Brevo DNS steps.

## Errors

| Case | Behaviour |
|---|---|
| SMTP down on subscribe | `503`, the new row is rolled back, and the UI shows "Email is off right now" |
| SMTP down on send | the subscriber is skipped, nothing is updated, and the next run retries |
| Unknown or deleted token on `/d/` | a neutral "link expired" page, no cookie, `404` status |
| Token unknown on `PUT` | `404`, and the web drops the stored token |
| Release table missing for a fact | that fact is skipped and logged (no email address), and the rest of the email goes |
| Hard bounce | v1: by hand in Brevo plus `purge --email` |

## Testing

- **Unit tests (pure):**
  - facts diff per source, including the first send, nothing changed, and a new species;
  - the reminder calendar, with weekend shifts and each id once;
  - the `to` allowlist against `//evil`, `/\evil`, `https:`, encoded variants and `/?saved=1`;
  - token signing: forged, truncated and other-version tokens are rejected;
  - email rendering (subject counts, unsubscribe headers present, no census or valuation
    fields).
- **API tests** (`api/tests/test_digest.py`) with a fake SMTP sink:
  - subscribe gives the same `202` for new, pending and active emails;
  - confirm through `/d/`;
  - the invite cookie is set only in private mode;
  - `PUT` and `GET` items;
  - one-click unsubscribe removes everything;
  - rate limits;
  - `send` skips empty weeks and respects `MAX_PER_RUN`;
  - an SMTP failure changes nothing.
- **Web tests:** the signup states, debounced sync, restore from `#digest=` merging within the
  caps, and a `404` dropping the token.
- **e2e:** save a school → subscribe → open the captured confirm link → Saved shows the item on
  a fresh browser context.

## Rollout

1. Merge with the migration. Deploy, which applies `066`. With SMTP unset the feature is off.
2. The owner creates the Brevo account, verifies the domain (SPF, DKIM, DMARC) and sets the
   `CLOSE_KNIT_SMTP_*` variables.
3. Run `preview` on a test subscription, send one real digest to the owner, then add the
   crontab line.
4. Watch `utm_source=digest` returns in the usage report.
