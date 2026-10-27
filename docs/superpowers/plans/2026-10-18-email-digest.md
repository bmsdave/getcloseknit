# Email Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An opt-in weekly email about saved schools and areas, sent only when something changed or a school date is near, with links that work while the site is private.

**Architecture:**
- Postgres tables hold subscribers and their items; tokens are HMAC-signed, not stored.
- A weekly CLI diffs fresh facts against the last email and sends through the existing SMTP settings.
- The web keeps the token in localStorage, syncs Saved to the server, and restores it from a `#digest=` link. Caddy lets `/d/*` past the shared login.

**Tech Stack:** Python 3 FastAPI + psycopg (`api/`), unittest; Next.js + TypeScript (`web/`), `tsx --test`, Playwright; Caddy; Postgres 18.

**Spec:** [docs/superpowers/specs/2026-10-18-email-digest-design.md](../specs/2026-10-18-email-digest-design.md)

**Status:** paused by the owner on 2026-10-18; do not start without their go-ahead (see the spec's status line).

## Global Constraints

- Never join the email to the analytics `visitor_id`: no such column, and no event or log line carries the email or a token.
- Token: `<subscriber id as 32 hex>.<sig>`, `sig = base64url(HMAC-SHA256(CLOSE_KNIT_DIGEST_SECRET, "<id>:<token_version>"))[:43]`, compared with `hmac.compare_digest`.
- The digest is off unless SMTP is configured **and** `CLOSE_KNIT_DIGEST_SECRET` has 32+ characters. Off means subscribe answers `503` and `send` exits with a message.
- Item kinds `school` (URN `^\d{6}$`) and `area` (`^uk:[a-z]+:[A-Z]\d{8}$`); at most 30 items.
- Consent wording id: `digest-consent-v1`. Checkbox copy: "Email me weekly when something I saved changes. Unsubscribe in one click."
- No email when there are no changes and no reminders. Send cap `CLOSE_KNIT_DIGEST_MAX_PER_RUN`, default 250.
- Reminder lead: 14 days. Ids and texts:
  - `secondary-deadline-YYYY` (31 Oct): "Secondary school applications close";
  - `reception-deadline-YYYY` (15 Jan): "Reception and junior applications close";
  - `secondary-offers-YYYY` (1 Mar or the next working day): "Secondary offers out";
  - `primary-offers-YYYY` (16 Apr or the next working day): "Primary offers out".
- Retention: pending 7 days, send log 90 days, unsubscribe deletes at once.
- Copy never promises a school place, never shows census figures or a per-home value, and has no tracking pixels.
- SQL strings start with a `-- digest:<name>` tag comment (the fake connections in tests key on it), like `site_feedback.py`.
- House look for the HTML email: snow-white background, a yarn accent, no olive or green (DESIGN.md).

## Review Focus

1. **A token leaks through a referrer or a log.** `/d/` responses must send `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, and Caddy must skip `/d/*` in the access log. Test in Task 6.
2. **An open redirect via `to`.** `//evil.com`, `/\evil.com`, `https://evil.com`, `%2F%2Fevil.com` and `/%5Cevil` must all land on `/`. Test in Task 2.
3. **Probing who is subscribed.** New, pending and active emails get the same `202` and an identical body, and nothing reveals status. Test in Task 6.
4. **The same week sent twice, or a reminder twice.** A second `send` within 6 days sends nothing, and a reminder id already in the log is not repeated. Test in Task 7.
5. **The restore merge blows the caps or overwrites.** Restoring adds to Saved and Compare without removing local items, and stops at `MAX_COMPARE` and `MAX_SAVED_ITEMS`. Test in Task 8.

---

### Task 1: Schema

**Files:**
- Create: `deploy/migrations/066-digest.sql`
- Test: `deploy/tests/test_digest_schema.py` (pattern: `deploy/tests/test_objections_schema.py`)

**Interfaces:**
- Produces: tables `digest_subscriber`, `digest_item` and `digest_send_log`, exactly as in the spec's Data model, with `token_version smallint NOT NULL DEFAULT 1` in place of any token column.

- [ ] **Step 1: Write the failing test.** `test_digest_tables_have_no_secret_or_visitor_columns`: parse the SQL text and assert the three tables exist. Assert `digest_subscriber` has `email`, `token_version`, `status`, `consent_version`, `consented_at`, `confirmed_at`, `last_sent_at` and no column matching `visitor|token_hash|ip`. Assert `digest_item` has `ON DELETE CASCADE` and `PRIMARY KEY (subscriber_id, kind, item_id)`, and that `digest_send_log.kind` is checked against `('confirm', 'digest', 'manage')`.
- [ ] **Step 2: Run** `cd deploy && ../.ae-venv/bin/python -m unittest tests.test_digest_schema -v`. Expected: FAIL (file missing).
- [ ] **Step 3: Write `066-digest.sql`** from the spec, idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS digest_subscriber_email`).
- [ ] **Step 4: Run** the same command and apply the file on the local DB (`ae-pgold` :5434, inside `BEGIN … ROLLBACK`). Expected: PASS, and psql reports no error.
- [ ] **Step 5: Commit** `feat(digest): schema 066`.

### Task 2: Signed tokens and safe links

**Files:**
- Create: `api/area_api/digest_links.py`
- Test: `api/tests/test_digest_links.py`

**Interfaces:**
- Produces:
  - `SECRET_ENV = "CLOSE_KNIT_DIGEST_SECRET"`;
  - `secret() -> str | None` (None when unset or under 32 chars);
  - `make_token(subscriber_id: str, version: int, key: str) -> str`;
  - `token_id(token: str) -> str | None` (the id when the shape is right, else None);
  - `token_ok(token: str, version: int, key: str) -> bool`;
  - `safe_target(to: str | None) -> str`;
  - `link(base_url: str, token: str, to: str) -> str` (`f"{base}/d/{token}?to={quoted safe_target}"`);
  - `landing(to: str, token: str) -> str`: `safe_target(to)` plus `utm_source=digest` when missing, plus `#digest=<token>` only when the target is `/?saved=1`.

- [ ] **Step 1: Write failing tests:**
  - `test_round_trip`: `token_ok(make_token(id, 1, K), 1, K)` is True.
  - `test_rejects_forged_truncated_and_other_version`: a changed last char, the token minus 1 char, version 2 and another key are all False. `token_id("x.y")` is None.
  - `test_secret_needs_32_chars`.
  - `test_safe_target`: each Review Focus #2 input gives `/`; `/area/lsoa/E01000001` stays.
  - `test_landing_adds_utm_and_hash_for_saved`: `landing("/?saved=1", T) == f"/?saved=1&utm_source=digest#digest={T}"`, and `landing("/school/100000", T) == "/school/100000?utm_source=digest"`.
- [ ] **Step 2: Run** `cd api && ../.ae-venv/bin/python -m unittest tests.test_digest_links -v`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** with `hmac`, `hashlib.sha256` and `base64.urlsafe_b64encode(...).rstrip(b"=")`. For `safe_target`, unquote once, then require a leading single `/`, no `//`, no `\`, no `:` before the first `/`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(digest): signed tokens and safe link targets`.

### Task 3: Store

**Files:**
- Create: `api/area_api/digest_store.py`
- Test: `api/tests/test_digest_store.py` (with a fake connection keyed on `-- digest:` tags, like `FakeFeedbackConnection` in `api/tests/test_site_feedback.py`)

**Interfaces:**
- Consumes: Task 1 tables.
- Produces:
  - `@dataclass(frozen=True) Item(kind: str, item_id: str, name: str)`;
  - `@dataclass(frozen=True) Subscriber(id: str, email: str, status: str, token_version: int, last_sent_at: datetime | None)`;
  - `class InvalidDigest(ValueError)`;
  - constants `KINDS`, `MAX_ITEMS = 30`, `MAX_EMAIL = 254`, `MAX_NAME = 120`, `CONSENT_VERSION = "digest-consent-v1"`, `PENDING_DAYS = 7`, `LOG_DAYS = 90`;
  - `clean_items(raw: object) -> list[Item]` (validates the id patterns, dedupes, ≤30, names trimmed to 120, area name may be empty);
  - `clean_subscribe(payload: Mapping) -> tuple[str, list[Item]]` (email lower-cased and trimmed, syntax `^[^@\s]+@[^@\s]+\.[^@\s]+$`, `consent is True`, `consentVersion == CONSENT_VERSION`);
  - `subscribe(connect, email: str, items: list[Item], now: datetime) -> tuple[str, Subscriber, bool]`, returning `(action, subscriber, created)` where the action is `"confirm"` for new or pending (a pending row gets `token_version + 1` and its items replaced) and `"manage"` for active (unchanged);
  - `get(connect, subscriber_id: str) -> Subscriber | None`;
  - `confirm(connect, subscriber_id: str, now: datetime) -> None`;
  - `replace_items(connect, subscriber_id: str, items: list[Item]) -> None` (keeps `last_facts` of items that stay);
  - `list_items(connect, subscriber_id: str) -> list[Item]`;
  - `delete(connect, subscriber_id: str) -> None`;
  - `purge(connect, now: datetime) -> dict[str, int]` (`{"pending": n, "log": n}`);
  - `purge_email(connect, email: str) -> int`;
  - `due(connect, now: datetime, limit: int) -> list[Subscriber]` (active, `last_sent_at` null or older than 6 days, oldest first);
  - `facts_of(connect, subscriber_id: str) -> list[tuple[Item, dict | None]]`;
  - `sent_reminders(connect, subscriber_id: str) -> set[str]`;
  - `record_send(connect, subscriber_id: str, now: datetime, kind: str, facts: dict[tuple[str, str], dict], reminders: list[str]) -> None` (one transaction: sets `last_facts` for the given keys, `last_sent_at` when kind is `"digest"`, and inserts the log row).

- [ ] **Step 1: Write failing tests:**
  - `test_clean_subscribe_rejects_missing_consent_bad_email_and_31_items`;
  - `test_clean_items_dedupes_and_checks_ids`;
  - `test_subscribe_new_pending_active` (actions `confirm`/`confirm`/`manage`, the pending version bumped, active unchanged, `created` only for new);
  - `test_replace_items_keeps_facts_of_staying_items`;
  - `test_due_skips_recent_and_pending_and_respects_limit`;
  - `test_purge_deletes_old_pending_and_log`;
  - `test_record_send_sets_facts_and_logs_reminders`.
- [ ] **Step 2: Run** `cd api && ../.ae-venv/bin/python -m unittest tests.test_digest_store -v`. Expected: FAIL.
- [ ] **Step 3: Implement** with tagged SQL constants (`-- digest:insert`, `-- digest:by-email`, …). `id` is `gen_random_uuid()` and is returned as a dashless hex string.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(digest): subscriber store`.

### Task 4: Facts and diffs

**Files:**
- Create: `api/area_api/digest_facts.py`
- Test: `api/tests/test_digest_facts.py`

**Interfaces:**
- Consumes: `Item` (Task 3).
- Produces:
  - `@dataclass(frozen=True) Change(kind: str, item_id: str, name: str, text: str, to: str)`;
  - `crime_direction(values: list[float]) -> str | None`, which compares the sum of the newest 3 values with the 3 before: `"up"` above +10%, `"down"` below −10%, else `"flat"`, and None with fewer than 6 values;
  - `read_area(connect, area_id: str, since: date) -> dict`, giving `{"name": str, "sales": {"count", "median", "through"}, "crime": {"period", "direction"} | None, "wildlife": sorted list[str]}`;
  - `read_school(connect, urn: str) -> dict`, giving `{"name": str, "inspection": {"published": "YYYY-MM-DD", "headline": str} | None}`;
  - `diff_area(item: Item, previous: dict | None, current: dict, today: date) -> list[Change]`;
  - `diff_school(item: Item, previous: dict | None, current: dict) -> list[Change]`.
- Data sources:
  - Sales come from `area_recent_sale` (count, `percentile_cont(0.5)` of `price`, `max(completion_date)`), using the column from `market.CARRIER_COLUMNS` for the carrier in `uk:<carrier>:<code>`.
  - Crime comes from `metric_value` with `metric_id = 'crime'`, the area's `geography_id`, ordered by `period`.
  - Wildlife comes from `area_wildlife.notable` for the `geography_id`.
  - The name comes from `area_geography.name`.
  - Inspections come from the newest `school_inspection` by `publication_date` for the URN, with the headline from the existing school-card labelling in `api/area_api/school_card.py`. If that labelling is not importable, map `overall` 1–4 to Outstanding / Good / Requires improvement / Inadequate, and otherwise use "Report card published".
  - Each reader joins `active_product_release → product_release_member` on `source_release_id`, the way `api/area_api/area_pages.py` does.
- Rules:
  - The sales `since` is `previous["sales"]["through"]`, or `today - 30 days` on the first send. Sales are reported when `count > 0`.
  - Crime is reported only when a previous fact exists, its period moved on, and the direction changed.
  - Wildlife reports names in `current` and not in `previous`, never on the first send.
  - A school reports when `published` is newer than the previous one, never on the first send.
- Texts:
  - sales: `f"{count} home{'s' if count != 1 else ''} sold since {since:%-d %b}, median £{median:,}"`;
  - crime: `f"Recorded crime, last 3 months vs the 3 before: {'higher' | 'lower' | 'about the same'} (police.uk, to {period})"`;
  - wildlife: `f"Newly recorded nearby: {', '.join(new)} (GBIF)"`;
  - school: `f"New Ofsted report published {published:%-d %b %Y}: {headline}"`.
- `to`: `/area/<carrier>/<code>` and `/school/<urn>`.

- [ ] **Step 1: Write failing tests:**
  - `test_crime_direction_bands` (+11% up, −11% down, +9% flat, 5 values None);
  - `test_first_send_reports_sales_only`;
  - `test_nothing_changed_gives_no_changes`;
  - `test_new_species_reported_by_name_only`;
  - `test_crime_reported_when_period_moves_and_direction_changes`;
  - `test_newer_inspection_reported`;
  - `test_texts_carry_no_census_or_valuation_words` (no `census|estimate|worth|value`).
  - SQL readers are tested with the tagged fake connection.
- [ ] **Step 2: Run** `cd api && ../.ae-venv/bin/python -m unittest tests.test_digest_facts -v`. Expected: FAIL.
- [ ] **Step 3: Implement** the pure diffs and the readers.
- [ ] **Step 4: Run** the same command, then check the readers' SQL on `ae-pgold` for one real LSOA and one URN. Expected: PASS, plus plausible numbers.
- [ ] **Step 5: Commit** `feat(digest): facts and diffs`.

### Task 5: Calendar and email rendering

**Files:**
- Create: `api/area_api/digest_calendar.py`, `api/area_api/digest_email.py`
- Test: `api/tests/test_digest_calendar.py`, `api/tests/test_digest_email.py`

**Interfaces:**
- Consumes: `Change` (Task 4).
- Produces:
  - `@dataclass(frozen=True) Reminder(id: str, on: date, text: str)`, `LEAD_DAYS = 14`, `reminders_for(today: date) -> list[Reminder]`;
  - `@dataclass(frozen=True) Email(subject: str, text: str, html: str, headers: dict[str, str])`;
  - `render_digest(changes: list[Change], reminders: list[Reminder], link: Callable[[str], str], unsubscribe_url: str) -> Email`;
  - `render_confirm(confirm_url: str, unsubscribe_url: str) -> Email`;
  - `render_manage(saved_url: str, unsubscribe_url: str) -> Email`;
  - `to_message(email: Email, to: str, sender: str) -> EmailMessage`.
- Copy:
  - digest subject: `f"{n} update{'s' if n != 1 else ''} on what you saved"`, where `n = len(changes) + len(reminders)`;
  - confirm subject: "Confirm your Close Knit weekly email";
  - manage subject: "Your Close Knit saved list";
  - footer: "Sources: HM Land Registry Price Paid Data, police.uk, Ofsted, GBIF.org. You get this because you subscribed on Close Knit." followed by the unsubscribe link;
  - headers `List-Unsubscribe: <{unsubscribe_url}>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.

- [ ] **Step 1: Write failing tests:**
  - `test_offer_days_move_off_weekends` (`secondary-offers-2026` on 2026-03-02, `primary-offers-2028` on 2028-04-17, `secondary-offers-2027` on 2027-03-01);
  - `test_due_window_is_14_days` (2026-10-17 gives `secondary-deadline-2026`, 2026-10-16 gives nothing, 2026-11-01 gives nothing);
  - `test_digest_subject_counts_and_headers`;
  - `test_html_has_no_img_and_links_go_through_link_fn`;
  - `test_confirm_and_manage_have_one_button_link`.
- [ ] **Step 2: Run** `cd api && ../.ae-venv/bin/python -m unittest tests.test_digest_calendar tests.test_digest_email -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** The HTML is inline-styled with no `<img>`. Every `Change.to` goes through `link`, and "My saved" is `link("/?saved=1")`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(digest): reminder calendar and email rendering`.

### Task 6: API routes, rate limits, Caddy, SMTP wrapper

**Files:**
- Modify: `api/area_api/notify.py`: add `smtp_ready() -> bool` and `send_message(message: EmailMessage) -> bool` over `_smtp_settings` and `_try_mail`.
- Modify: `api/area_api/app.py`: add the routes next to `/api/v1/feedback`.
- Modify: `api/area_api/ratelimit.py`:
  - `DEFAULT_LIMITS["digest"] = "5/hour,20/day"` and `DEFAULT_LIMITS["digestlink"] = "60/hour,300/day"`;
  - in `classify`, `/api/v1/digest/subscribe` maps to `("digest", 1)`, and other `/api/v1/digest/` paths and `/d/` map to `("digestlink", 1)`.
- Modify: `deploy/access-private.caddy`: `handle /d/* { import proxy api:8080 }` before the login, next to `/access/*`.
- Modify: `deploy/Caddyfile`: add `/d/*` to the `@api` matcher, and `log_skip /d/*` next to `log_skip /api/v1/health`.
- Create: `web/src/app/api/v1/digest/subscribe/route.ts` and `web/src/app/api/v1/digest/items/route.ts`, which forward to the API like `web/src/app/api/v1/feedback/route.ts` and return the upstream status. Without an evidence service they return `503`.
- Modify: `contracts/openapi.yaml`, if routes are listed there (`include_in_schema=False` otherwise).
- Test: `api/tests/test_digest_api.py`, plus cases in `api/tests/test_ratelimit.py`.

**Interfaces:**
- Consumes: Tasks 2, 3 and 5; `invites.access_secret()`, `invites.cookie_header(secret)`, `invites.page(title, body)`.
- Produces:
  - `POST /api/v1/digest/subscribe`: `202`, `422 {"error":"invalid-digest"}` or `503 {"error":"digest-off" | "digest-unavailable"}`;
  - `GET` and `PUT /api/v1/digest/items` with header `X-Digest-Token`: `200 {"items":[{"kind","id","name"}]}`, `204`, `404` or `422`;
  - `GET /d/{token}?to=`: `303` to `digest_links.landing(...)`, or a `404` page;
  - `GET /d/{token}/unsubscribe` (a page with a POST button) and `POST /d/{token}/unsubscribe` (a `200` "You're unsubscribed" page whether or not the token is valid).
- Behaviour:
  - Subscribe sends `render_confirm` or `render_manage` through `notify.send_message`. When the send fails and `created` is true, it calls `delete` and answers `503`. A successful send is logged with `record_send(kind="confirm" | "manage", facts={}, reminders=[])`.
  - `/d/` confirms a pending row and sets `invites.cookie_header` only when `CLOSE_KNIT_ACCESS == "private"` and `invites.access_secret()` is set. All `/d/` responses send `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.

- [ ] **Step 1: Write failing tests** with the app's swappable `_connect` and a patched `notify.send_message` sink:
  - `test_subscribe_same_202_for_new_pending_active` (equal bodies and headers);
  - `test_subscribe_off_without_secret_or_smtp`;
  - `test_send_failure_rolls_back_new_row`;
  - `test_confirm_link_activates_and_redirects_with_hash`;
  - `test_cookie_only_in_private_mode`;
  - `test_d_headers_no_referrer_no_store`;
  - `test_bad_token_404_no_cookie`;
  - `test_items_get_put_and_404`;
  - `test_one_click_unsubscribe_deletes`;
  - `test_ratelimit_classes_for_digest_paths`.
- [ ] **Step 2: Run** `cd api && ../.ae-venv/bin/python -m unittest tests.test_digest_api tests.test_ratelimit -v`. Expected: FAIL.
- [ ] **Step 3: Implement** the routes. The sync store calls run through `run_in_executor`, as feedback does. Neither emails nor tokens go into logs.
- [ ] **Step 4: Run** the same command, then `caddy validate --config deploy/Caddyfile` (docker `caddy` image). Expected: PASS and "Valid configuration".
- [ ] **Step 5: Commit** `feat(digest): API routes, limits and Caddy access`.

### Task 7: Weekly send CLI and ops

**Files:**
- Create: `api/area_api/digest.py`, `deploy/tools/digest.sh` (pattern: `deploy/tools/feedback.sh`)
- Modify: `deploy/.env.example`:
  - `CLOSE_KNIT_DIGEST_SECRET=`;
  - `CLOSE_KNIT_DIGEST_FROM=Close Knit <digest@getcloseknit.com>`;
  - `CLOSE_KNIT_DIGEST_MAX_PER_RUN=250`.
- Modify: `deploy/preflight.sh`: warn "digest off: no SMTP or secret", not a failure.
- Modify: `RELEASE-CHECKLIST.md`: Brevo domain steps (SPF, DKIM, DMARC), the env vars, and the crontab line `15 8 * * 6 cd /srv/close-knit && deploy/tools/digest.sh send` (adjust the path to the server's checkout).
- Test: `api/tests/test_digest_send.py`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
  - `build(connect, sub: Subscriber, today: date) -> tuple[list[Change], list[Reminder], dict[tuple[str, str], dict]]`, where reminders exclude `sent_reminders` and need at least one school item;
  - `send(connect, now: datetime, *, limit: int, mail: Callable[[EmailMessage], bool], base_url: str, key: str, sender: str) -> dict[str, int]`, with keys `due`, `sent`, `skipped` and `failed`;
  - `preview(connect, email: str, now: datetime, base_url: str, key: str) -> str`;
  - `main(argv: list[str] | None = None) -> int`, with `send`, `preview <email>` and `purge [--email X]`.
- Rules:
  - An empty `build` is skipped and writes nothing.
  - When the mail succeeds, `record_send(kind="digest", facts=<all current facts>, reminders=<ids sent>)`.
  - When the mail fails, nothing is written.
  - The run stops after `limit` due subscribers.
  - With SMTP or the secret missing, it prints "digest off: …" and returns 1.

- [ ] **Step 1: Write failing tests:**
  - `test_empty_week_sends_nothing_and_writes_nothing`;
  - `test_second_run_within_6_days_sends_nothing`;
  - `test_reminder_goes_once`;
  - `test_reminders_need_a_saved_school`;
  - `test_mail_failure_changes_nothing`;
  - `test_limit_caps_the_run`;
  - `test_preview_writes_nothing`;
  - `test_off_without_config_returns_1`.
- [ ] **Step 2: Run** `cd api && ../.ae-venv/bin/python -m unittest tests.test_digest_send -v`. Expected: FAIL.
- [ ] **Step 3: Implement**, plus `digest.sh` (`docker compose exec -T api python -m area_api.digest "$@"`) and the env, preflight and checklist edits.
- [ ] **Step 4: Run** the same command and `bash -n deploy/tools/digest.sh deploy/preflight.sh`. Expected: PASS and no syntax errors.
- [ ] **Step 5: Commit** `feat(digest): weekly send CLI and ops`.

### Task 8: Web: signup, sync, restore, copy

**Files:**
- Create: `web/src/lib/digest.ts`, `web/src/components/digest-signup.tsx`
- Modify:
  - `web/src/lib/saved-items.ts`: add `addSavedItem(input: SavedItemInput): boolean`, which adds when absent, never removes, and respects `MAX_SAVED_ITEMS`;
  - `web/src/components/saved-panel.tsx`: render `<DigestSignup />` when Saved has at least one school or a compared area;
  - `web/src/components/close-knit.tsx`: call `restoreFromHash()` once on mount and `startDigestSync()` in an effect;
  - `web/src/components/watch-listings.tsx`: "We don't collect listings or emails." becomes "We don't collect listings. Email only if you subscribe to the digest.";
  - `web/src/app/privacy/page.tsx`: add a section `digest`, "Email digest": what is stored (email, saved school and area ids, consent time), Brevo as processor, retention (pending 7 days, until unsubscribe), one-click unsubscribe, no tracking pixels, never linked to analytics. Add it to the section list.
- Test: `web/tests/digest.test.ts`

**Interfaces:**
- Consumes: the Task 6 HTTP routes; `readSavedItems`, `SAVED_CHANGE_EVENT`, `addCompared`, `COMPARE_CHANGE_EVENT` and `MAX_COMPARE`.
- Produces:
  - `DIGEST_TOKEN_KEY = "close-knit.digest.v1"`, `CONSENT_VERSION = "digest-consent-v1"`;
  - `type DigestItem = { kind: "school" | "area"; id: string; name: string }`;
  - `digestItems(): DigestItem[]` (saved schools plus compared areas, at most 30);
  - `storedToken(): string | null`;
  - `subscribe(email: string): Promise<"sent" | "off" | "invalid">`;
  - `startDigestSync(): () => void` (2000 ms debounce, `PUT`, a `404` clears the token);
  - `restoreFromHash(): Promise<boolean>`.
- UI:
  - signup states: form, then "Check your inbox to confirm"; "Email is off right now" for `off`; an invalid email marks the field;
  - subscribed state: "Weekly email on", with an "Unsubscribe" link to `/d/<token>/unsubscribe`.

  Use one block and the existing form styles, with no new heavy components. Labels are terse.

- [ ] **Step 1: Write failing tests:**
  - `test digestItems maps saved schools and compared areas and caps at 30`;
  - `test subscribe maps 202/503/422`;
  - `test sync debounces and PUTs once for a burst`;
  - `test sync 404 clears the token`;
  - `test restoreFromHash merges without removing and respects caps, stores the token, clears the hash`;
  - `test addSavedItem never removes`.
- [ ] **Step 2: Run** `cd web && npx tsx --test tests/digest.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `cd web && npm test && npm run typecheck`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(digest): signup, sync and restore in Saved`.

### Task 9: End-to-end and the full gate

**Files:**
- Create: `web/e2e/digest.spec.ts`

- [ ] **Step 1: Write the e2e test** with `page.route` mocks for `/api/v1/digest/*`. Save a school, fill in the email, tick the box, click Subscribe, and expect "Check your inbox". Then, in a fresh context, go to `/?saved=1#digest=<token>` with a mocked `GET items`, and expect the school in Saved and the hash gone. Run it on desktop and mobile.
- [ ] **Step 2: Run** `cd web && PLAYWRIGHT_TEST_PORT=4380 npx playwright test e2e/digest.spec.ts`. Expected: PASS (2 projects).
- [ ] **Step 3: Run the full gate** with `./gate.sh --mobile`. It stops at the deploy tests, so run the web and Playwright steps by hand. Expected: no new failures. Known failures are listed in the deploy memory notes and are not caused by this branch.
- [ ] **Step 4: Commit** `test(digest): e2e signup and restore`. Push, open the PR, and list in it the owner steps from the spec's Rollout (Brevo account, DNS, env, crontab).
