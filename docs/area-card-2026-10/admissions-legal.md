# Last-distance-offered: can we publish it? (2026-10-15)

This is a research note, not legal advice.

## 1. What others do

- **Locrating**: LDO is shown in school popups, behind a paid membership. It collects from 150+ council sites and "manually checks every last distance offered". No licence or permission is stated (read from search snippets; the site blocks fetches). [blog](https://www.locrating.com/blog/collecting-last-distance-offered-data.aspx), [pricing](https://www.locrating.com/pricing.aspx)
- **School Atlas**: free, 22,500+ LDO records; cites "local council admissions data", no permission. OGL is claimed only for DfE/Ofsted/ONS data. [terms](https://www.schoolatlas.co.uk/terms)
- **SchoolGuide**: no LDO; DfE census heat maps, sends users to councils. [guide](https://www.schoolguide.co.uk/blog/secondary-school-catchment-areas)
- **Snobe**: free, with no LDO and no stated source or licence. [site](https://www.snobe.co.uk/)

Peers republish without permission: tolerated risk, not a licence.

## 2. Council terms (sample)

- **Hackney**: "All content is available under the Open Government Licence v3.0" ([terms](https://hackney.gov.uk/disclaimer/)). **Recheck Hackney's publishable flag.**
- **Barnet**: copyright and database right reserved; "not for any commercial or public use" ([copyright](https://www.barnet.gov.uk/your-council/policies-plans-and-performance/privacy-notices/copyright)).
- **Wandsworth**: "private and non-commercial use purposes only" ([terms](https://www.wandsworth.gov.uk/about-this-website/terms-and-disclaimer)).
- **Kensington & Chelsea**: personal copying only; "may not republish… or make available to the public" ([terms](https://www.rbkc.gov.uk/terms-of-use)).
- **Southwark, Camden**: no reuse clause found (silent, or bots blocked).

These are boilerplate defaults, not decisions about admissions data.

## 3. The law

- **Copyright**: a distance number is a fact. A plain school-and-distance table probably lacks the "intellectual creation" that database copyright requires (CDPA s3A).
- **Database right**: this protects investment in *obtaining, verifying or presenting* data, not in *creating* it ([BHB v William Hill](https://curia.europa.eu/en/actu/communiques/cp04/aff/cp040089en.pdf)). Councils create LDO in their own allocation run, which weakens a claim, but we take each council's whole table, a "substantial part" ([CRDR 1997 reg 16](https://www.legislation.gov.uk/uksi/1997/3032/part/III)).
- **RPSI 2015** ([SI 2015/1415](https://www.legislation.gov.uk/uksi/2015/1415/contents)):
  - Published council documents are in scope (reg 5).
  - The council **must permit** reuse when it gets a valid request (reg 7). The request must be written and give a name, an address, the document and the purpose (reg 6).
  - The council must respond within 20 working days or give notice of an extension (reg 8).
  - Conditions must not unnecessarily restrict reuse (reg 12), and charges are capped at marginal cost (reg 15).

## 4. Options, lowest risk first

1. **(c) Publish OGL councils only; link to the council's page for the rest.** No risk; low coverage.
2. **(b) Send RPSI requests to the 31 councils.** Low risk. A statutory route; the likely answer is OGL within about 4 weeks.
3. **(d) Show a coarse band (under 500 m / 0.5–1 km / over 1 km).** Low to medium risk; still council-derived, less useful.
4. **(a) Publish all now with attribution.** Medium risk. Peers do this; the realistic worst case is a takedown request, but it breaches stated terms (Barnet, Wandsworth, Kensington & Chelsea).

**Template email**

> Subject: Re-use request under the Re-use of Public Sector Information Regulations 2015
> Dear Information Governance team,
> Under regulation 6 I request permission to re-use [Council]'s published "last distance offered" figures for [years] at [URL].
> Applicant: [name], Close Knit, [postal address], [email].
> Purpose: display them, credited and linked, on a free London home-search website.
> Please confirm whether reuse is permitted under the Open Government Licence v3.0, or state any conditions (reg 12), within 20 working days (reg 8).
> Regards, [name]

## Recommendation

Do **(c) now and (b) in parallel**:

- Publish Harrow, Lambeth and Hackney (after verifying Hackney).
- Link to the council's own page for the rest.
- Send the RPSI requests to the 31 councils and set `publishable=true` for each one as replies arrive.
- Use (d) only for councils that refuse or stay silent after 8 weeks.
