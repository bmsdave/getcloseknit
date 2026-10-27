# Email to the GLA: LAEI 2022 reuse

Draft for the owner. The dataset page was checked on 2026-10-27. It names the GLA Air Quality
Team as maintainer and states no licence. The Datastore API returns "Not Specified".

Unlocks: `CLOSE_KNIT_AIR_QUALITY` in a public production (FLAGS.md). If the GLA refuses, drop
the London layer and use Defra's 1 km PCM map (OGL v3.0) for London too.

---

**To:** airqualitylondon@london.gov.uk
**Subject:** Permission to republish LAEI 2022 concentrations (Open Government Licence?)

Dear GLA Air Quality Team,

I run Close Knit (getcloseknit.com), a free website that helps people choose where to live
in London. Please confirm in writing that we may republish figures derived from this dataset:

- **London Atmospheric Emissions Inventory (LAEI) 2022**, GLA and TfL, London Datastore:
  https://data.london.gov.uk/dataset/london-atmospheric-emissions-inventory-laei-2022-2lg5g
- File: `LAEI2022-Concentrations-Data-CSV.zip` (updated 19 May 2026).

**How we use it**

- We read the modelled annual mean NO2 and PM2.5 (20 m grid) at each home's location.
- We publish only averages per area (LSOA, MSOA and borough). These appear as a "Clean air"
  rating, a map layer and a short note on each area's page.
- We do not redistribute the grid or the raw files.
- Every use carries the credit "London Atmospheric Emissions Inventory 2022, Greater London
  Authority and Transport for London", and says the figures are modelled, not measured.
- The site is free to use. It is run by a company and may earn referral fees from services
  such as conveyancers. The air data itself is never sold.

**Questions**

1. Is LAEI 2022 published under the Open Government Licence v3.0? If not, what terms apply?
2. Do those terms allow this use on a commercial website, its API and AI-assistant tools?
3. Would you like a different attribution wording?

The dataset page states no licence, and the London Datastore terms say the data may be used
"for any purpose". We would like this confirmed before we make the site public.

Thank you,

[Name]
[Ltd legal name], trading as Close Knit
hello@getcloseknit.com

---

After the reply: save it under `docs/legal/` and update the LAEI row in `DATA-LICENCES.md` and the
`CLOSE_KNIT_AIR_QUALITY` row in `FLAGS.md`.
