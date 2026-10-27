# Close Knit web UX remediation — final report (UX-74)

Programme: UX-01 through UX-74, all local on this macOS device. Merge gate throughout:
independent review + local verification only (no CI wait). Tip at evidence time:
`2125220 [UX-73] Run the complete gate (#158)`.

## Final gate (clean revision 2125220, worktree /private/tmp/ux-74-worktree)

| Gate | Result | Log |
|---|---|---|
| Unit (`npm test`) | 345 pass / 0 fail | /tmp/ux74-unit.log |
| Typecheck (`tsc --noEmit`) | clean | /tmp/ux74-tsc.log |
| Production build (`next build`) | clean | /tmp/ux74-build.log |
| Desktop Playwright, no max-failures, workers=1 | 205 passed / 0 failed / 2 skipped | /tmp/ux74-desktop.log |
| Frame budget (10 ms p95 style updates) | passes unmodified | in desktop gate |
| Snapshots | byte-stable, no baseline edits | in desktop gate |
| Failure-classification ratchet | 12 rows exact, valid categories, evidence paths exist | in unit gate |
| Cache-absent shape (`serviceWorkers: block`) | passes inside the gate | in desktop gate |

The 2 desktop skips are pre-existing project guards, not regressions:
`e2e/accessibility.spec.ts:55` and `e2e/explorer.spec.ts:108` (mobile-only journeys).

Mobile (WebKit) was classified on identical app code under UX-73 and is unchanged
by UX-74 (report-only task): 6 passed, 10 skipped (9 desktop-contract rendering
self-skips + 1 desktop-only offline test), 191 failed — 189 `page.goto` timeouts,
1 `waitForResponse` armed before a failed goto, 2 `context.close` in `finally`
after a timed-out body. Every failure roots at WebKit loopback being unreachable
on this host; zero app-level failures. Full breakdown: /tmp/ux73-mobile.log.

## Final journey evidence (UX-74, temporary spec, deleted after inspection)

`e2e/zz-final-journey.spec.ts` (removed post-inspection) operated the full journey
with controls, 2/2 green: search → select → data-mode switch (pointer click to
Real, keyboard ArrowLeft back to Demo) → all five evidence tabs with
single-tabpanel invariant → sheet close + keyboard-Enter reopen → Property
diligence checklist → wizard → matches → two-area comparison dialog → profile
share confirm (`#profile=v1.` fragment) → shortlist save → reload persistence
(ranking + saved shortlist survive). First run failed for a test-authoring
reason: evidence tabs live on the explorer surface, not the matches surface;
reordering the journey (Inspect before Set-needs) turned it green with no
product change — recorded honestly.

Pixel-inspected screenshots (ephemeral, /tmp): ux74-1280-explorer,
ux74-1280-matches, ux74-1280-property, ux74-1280-compare, ux74-1280-reopened,
ux74-390-explorer, ux74-390-property, ux74-390-matches. Observed: warm neutral
map, dark green controls, serif headings, explicit provenance (source release,
demo-data framing, honest "Not published / not ranked" unknowns), loaded
ranking (#1 South Bank 74/100, #2 Westminster 65/100, 75% evidence) persisted
after reload, comparison dialog names release/profile and never ranks unknowns,
390 px sheet readable with scrollable layer strip clearing the zoom cluster.

## Audit blockers resolved (all 12 baseline rows)

| # | Pinned test | Category | Resolved by | Current state |
|---|---|---|---|---|
| 1 | api-contracts:3 versioned contracts | intentional contract change | UX-67 #152 | passes in final gate |
| 2 | api-contracts:93 sourced non-probabilistic evidence | stale fixture | UX-67 #152 | passes in final gate |
| 3 | decision-brief:83 sourced brief + export | product regression | UX-73 #158 (strict-mode helper + redaction repair) | passes in final gate |
| 4 | decision-brief:150 explicit unavailable / refused empty brief | product regression | UX-61 #147 | passes in final gate |
| 5 | explorer:267 share confirmation boundary | intentional contract change | UX-68 #153 | passes in final gate |
| 6 | explorer:385 clipboard-denial share | intentional contract change | UX-68 #153 | passes in final gate |
| 7 | noise-context:58 no quietness guarantee | stale fixture | UX-67 #152 | passes in final gate |
| 8 | official-geography:9 code search + reload | brittle locator | UX-14 #100 area; residual pins UX-73 #158 | passes in final gate |
| 9 | planning-context:45 honest stale/unverified | stale fixture | UX-67 #152 | passes in final gate |
| 10 | rendering:8 diagnostics geometry | product regression | UX-69 #154 | passes in final gate |
| 11 | rendering:28 10 ms p95 budget | product regression | UX-69 #154 + UX-70 #155 | passes in final gate |
| 12 | rendering:83 visual stability | product regression | UX-71 #156 | passes in final gate |

No test was skipped or weakened to conceal a regression. The two UX-73 pin
corrections (fragment-only `goto` → explicit `reload`; empty-list assertion
scoped to the "Nothing saved yet" copy) strictly preserve intent and are
documented in #158.

## Remaining non-blocking limitations

- L1 (environment): mobile/WebKit gate stays loopback-blocked (goto-only
  timeouts); no mobile pixels capturable on this host. Desktop + unit +
  typecheck carry release confidence per programme rule.
- L2 (cosmetic, pre-existing): the compass badge overlaps bottom-sheet content
  at 390 px (see ux74-390-explorer/property.png). Controls remain operable.
- L3 (cosmetic, pre-existing): comparison provenance strings wrap mid-token
  inside the dialog (see ux74-1280-compare.png). Content stays contained.
- L4 (record-keeping): /tmp logs and screenshots are ephemeral; the durable
  record is this report plus the in-repo baselines and classification table.

## Cleanup

Temporary journey spec deleted after pixel inspection; no other temporary files
in the repo (`git status` clean apart from this report). Post-merge worktree /
branch removal and origin/main verification are recorded in the programme
progress log. Branch: `ux/74-final-journey`; PR: (this PR).

## Programme ledger (merge commits on origin/main)

Repo: the former monorepo (PR `NNN` → `/pull/NNN`).
Task pack: #85. UX-66 (#87) merged out of order after UX-02; all else sequential.

| Task | Title | PR | Commit |
|---|---|---|---|
| UX-01 | Create an isolated implementation worktree | #86 | 306c592 |
| UX-02 | Add real-mode evidence-request regression | #88 | f6458af |
| UX-03 | Reject fixture payloads in real mode with explicit unavailable state | #89 | 093acbf |
| UX-04 | Require data-mode inputs in LayerPicker | #90 | 11d5e8c |
| UX-05 | Prove saved controller mode reaches the layer picker | #91 | 392f32e |
| UX-06 | Add visible Demo/Real mode selector to LayerPicker | #92 | 8606e76 |
| UX-07 | Require connection and shared scope in EvidencePanel | #93 | 4001887 |
| UX-08 | Route evidence loads through plan/request guard | #94 | 4492307 |
| UX-09 | Reject unavailable real layers before fetching | #95 | 1619976 |
| UX-10 | Prove delayed demo responses cannot overwrite real mode | #96 | d1d3003 |
| UX-11 | Derive global data labels from mode, release, connection | #97 | 7c1ec7c |
| UX-12 | Reject conflicting data requests visibly | #98 | caaaa1b |
| UX-13 | Consolidate data-trust coverage into agreement matrix | #99 | 89ce1d7 |
| UX-14 | Separate committed search label from editable query | #100 | 62a3513 |
| UX-15 | Prove selection focuses the selected-area heading | #101 | da52424 |
| UX-16 | Dismiss search results on outside pointer and blur | #102 | aa84d95 |
| UX-17 | Ignore late search responses by query identity | #103 | 4a24ab9 |
| UX-18 | Repair preference field layout at 320-1280px | #104 | b4bcd8c |
| UX-19 | Keep comparison row labels readable in narrow surface | #105 | 9fc7ee0 |
| UX-20 | Remove the mobile control collision | #106 | 22fe091 |
| UX-21 | Create the preference wizard shell | #107 | f0e7830 |
| UX-22 | Build the Needs stage | #108 | 3b7a31d |
| UX-23 | Validate Needs before continuing | #109 | 19b2f66 |
| UX-24 | Build the Priorities stage | #110 | 9083beb |
| UX-25 | Explain hard limits in the Priorities stage | #111 | 91bbd6b |
| UX-26 | Build the optional Refine stage | #112 | d3c4210 |
| UX-27 | Build the Review stage | #113 | 81f28c2 |
| UX-28 | Preserve progress on Back and Close | #114 | f98c258 |
| UX-29 | Keep profile compatibility | #115 | 02369df |
| UX-30 | Move profile deletion out of the primary flow | #116 | c29e03b |
| UX-31 | Remove total-cost controls from onboarding | #117 | ae574dd |
| UX-32 | Remove leasehold checks from onboarding | #118 | 21ac476 |
| UX-33 | Test the complete wizard | #119 | a79413a |
| UX-34 | Add evidence navigation | #120 | d5038d4 |
| UX-35 | Build the Overview section | #121 | d18409d |
| UX-36 | Move housing evidence | #122 | 29bd7af |
| UX-37 | Move environmental evidence | #123 | 52364f3 |
| UX-38 | Move planning evidence | #124 | 48febda |
| UX-39 | Create the Property section | #125 | 921c38c |
| UX-40 | Relocate property diligence | #126 | 46e2894 |
| UX-41 | Separate area and property language | #127 | 327a27c |
| UX-42 | Collapse the pre-selection empty state to a map-first peek | #128 | 865b8b7 |
| UX-43 | Make evidence close and reopen predictable | #129 | 1411125 |
| UX-44 | Cover evidence disclosure and no-refetch navigation | #130 | 4cf0b82 |
| UX-45 | Move Compare into result cards as named checkboxes | #131 | bc136b6 |
| UX-46 | Add a persistent comparison tray | #132 | 7d54eef |
| UX-47 | Enforce comparison selection bounds visibly | #133 | 4b1a6ee |
| UX-48 | Open comparison in a native modal dialog | #134 | 336f58b |
| UX-49 | Keep comparison headers and labels stuck while scrolling | #135 | f4123c0 |
| UX-50 | Stack comparison factor cards on narrow viewports | #136 | cde9145 |
| UX-51 | Name carrier and reason in unknown comparison cells | #137 | a7ec4e5 |
| UX-52 | Keep focus and recompute on in-dialog removal | #138 | 28a260f |
| UX-53 | Cover decision-output alignment with compared finalists | #139 | 8f92fd6 |
| UX-54 | Cover cardinalities, ties, and four-area library output | #140 | a9e1c6b |
| UX-55 | Emphasise the selected area without branching hue on selection | #141 | b9d30cf |
| UX-56 | Label audited areas from deterministic source names | #142 | a3e9e12 |
| UX-57 | Document map colour meaning with a live map legend | #143 | ddff268 |
| UX-58 | Keep the active mobile layer visible in its strip | #144 | fe4b873 |
| UX-59 | Track strip overflow with directional fade cues | #145 | 127aa7d |
| UX-60 | Centralize ordinal formatting in formatOrdinal | #146 | 53355ec |
| UX-61 | Give repeated actions unique accessible names | #147 | e4c14b2 |
| UX-62 | Normalize interactive targets to 44px | #148 | a097890 |
| UX-63 | Trap dialog focus, arrow-navigate evidence tabs | #149 | b2fefee |
| UX-64 | Meet AA with a field-line token and shared muted text | #150 | 6e9bf3f |
| UX-65 | Verify journey at 200 percent zoom and reduced motion | #151 | 5e88ac4 |
| UX-66 | Classify all 12 browser-suite failures | #87 | ddedd44 |
| UX-67 | Refresh stale e2e pins for current evidence contracts | #152 | 90664da |
| UX-68 | Drive profile sharing through the confirmation dialog | #153 | 46a04d0 |
| UX-69 | Restore on-demand rendering diagnostics | #154 | 3deabb4 |
| UX-70 | Pin the style/geometry cadence split in the budget test | #155 | 6505520 |
| UX-71 | Renew visual baselines after pixel inspection | #156 | 769825a |
| UX-72 | Delete dead locals and enforce no-unused via typecheck | #157 | 1e136ec |
| UX-73 | Run the complete gate | #158 | 2125220 |
| UX-74 | Repeat the full audited journey manually | (this PR) | (this merge) |
