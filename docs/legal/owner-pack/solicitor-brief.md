# Brief for a solicitor: one review before going public

Draft for the owner to send with the documents listed below. Ask for a fixed fee.

**Who we are.** Close Knit (getcloseknit.com) is a free website, API, AI-assistant (MCP)
endpoint and Chrome extension. It helps people choose where to live in England, starting with
London. It is run by [Ltd legal name], a one-person company. The site is a private preview
today. Each risky feature is built but sits behind a server switch that is off when the site
is public. Your answers decide which switches we turn on.

**What we want.** Written yes / no / yes-if answers to the questions below, and any changes to
our terms, privacy notice and LIA.

## Questions, and the switch each answer unlocks

| # | Topic | Question | Unlocks |
|---|---|---|---|
| 1 | EPC per home | The EPC open-data terms put non-address fields under OGL v3.0 and give Royal Mail/OS rights to address fields. May we show, for each home (addressed from HM Land Registry Price Paid), its EPC floor area, energy rating, certificate date, type, built form, age band, rooms and floor level, plus £/m² for each sale? | `CLOSE_KNIT_EPC_PER_HOME`, `CLOSE_KNIT_PER_HOME_PRICE_PER_SQM` |
| 2 | EPC addresses | May we list homes with no recorded sale using the address and postcode on their EPC certificate? Or do we need an AddressBase/PAF licence first? | `CLOSE_KNIT_EPC_ADDRESSES` |
| 3a | Extension: on-page panel | Rightmove, OnTheMarket and SpareRoom terms ban changing or overlaying their pages. Our panel and the line under results run in the user's own browser. They store no portal data and say "not affiliated". What is our exposure for inducing breach of contract, database right and copyright? Is the Chrome side panel (nothing on their page) materially safer? | `CLOSE_KNIT_EXTENSION_MODES` (inline / side-panel / off per portal) |
| 3b | Extension: map pop-up | When a portal's map pin lacks the data, the extension fetches that one listing page in the user's browser after the user opens the pin. Is that "automated access" a problem? | `CLOSE_KNIT_EXTENSION_FEATURES` (`mapPopup`, `resultsLine`) |
| 3c | Extension: listing match | May we match a listing to a full address, and show a value range for it? | `CLOSE_KNIT_ADDRESS_MATCH`, `CLOSE_KNIT_HOME_VALUE` |
| 3d | Extension: area statistics | May we publish area medians and counts (minimum N, no IDs or addresses) computed in users' browsers from the listings they view? | Not built yet (category C in the strategy) |
| 3e | Extension: store listing | Is it safe to move from an unlisted to a public Chrome Web Store listing, with our terms and notices as drafted? | Public store listing |
| 4 | LIA | Does our legitimate-interests assessment hold for publishing each home's recorded sale history, its area's price range and the coarse position of its last sale (one of six bands)? Is the wording safe ("not a valuation")? Does it still hold as we expand from London to all of England? | Signed LIA; `CLOSE_KNIT_ACCESS=public`; `CLOSE_KNIT_ENGLAND` in public |
| 4b | LIA, later | Could any of these pass a balancing test: a per-home model estimate; named homes with the biggest gains and losses; estate agents' Companies House officers; date, time and sex of road casualties? | `CLOSE_KNIT_PER_HOME_VALUATION`, `CLOSE_KNIT_SNAKES`, `CLOSE_KNIT_AGENCY_OFFICERS`, `CLOSE_KNIT_ROAD_CASUALTY_DETAIL` |
| 5 | Partner referral fees | We plan "Next steps" links to conveyancers, surveyors, mortgage brokers, insurers and broadband, paid per referral. Each partner is labelled, unpaid options are shown, and a public "How we make money" page explains it. Is this disclosure enough under consumer law (CMA, DMCC Act 2024), the CAP Code and SRA referral-fee rules? For mortgages and insurance, do we stay outside FCA authorisation as an introducer, and who must approve our wording? | Partner links (not built; no flag yet) |
| 6 | Terms and privacy | Please review `/terms`, `/privacy` and the extension's privacy text. Does the extension need a separate privacy policy? Is our liability cap enforceable against consumers? Is our "Independence / not affiliated" and trade mark notice for portal names adequate? | `CLOSE_KNIT_ACCESS=public`; public store listing |

## Documents to send

- `docs/legal/legitimate-interests-assessment.md`, plus the live pages `/privacy`,
  `/privacy/legitimate-interests` and `/terms`
- `docs/superpowers/specs/2026-10-18-extension-legal-strategy.md` (extension posture, modes,
  the "never" list)
- `DATA-LICENCES.md`: the rows for Price Paid, EPC and OS
- `FLAGS.md`: every switch and its blocker
- The English draft of the "How we make money" page (the quoted text in
  `docs/growth-2026-10/monetization.md`; the rest of that file is internal notes)
- Screenshots: a property page, the extension panel on Rightmove and Zoopla, the side panel

## Already decided (no need to advise)

- We never store portal listings, prices or photos, and never fetch portal pages from our servers.
- No per-home valuation is shown.
- "Hide my home" removes a home within 30 days.
- ICO registration is in the company's name.
