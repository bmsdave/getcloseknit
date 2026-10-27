# Primary → secondary destinations: data requests (drafts, 2026-10-16)

Two drafts. Only the owner sends them, from their own address. Before sending, fill in the parts in [brackets].

---

## 1. GLA: will the London Schools Atlas be refreshed?

**To:** londonschoolsatlas@london.gov.uk
**Subject:** London Schools Atlas: Feeder_Pri2Sec refresh after 2016?

Hello,

We use the London Schools Atlas "Feeder_Pri2Sec" tables from the London Datastore (OGL v2), crediting the GLA and the National Pupil Database, to show parents which secondary schools each London primary's Year 6 pupils moved on to.

The latest file is from the 2016 census. Could you tell us:

1. whether you plan to publish later years (ideally 2021–2025);
2. if not, whether you could share the same table for later years under the same licence and suppression rule (counts under 3 hidden);
3. whether you know of another public source of this table.

Thank you very much for publishing it in the first place.

[Your name]
[Close Knit · getcloseknit.com]

---

## 2. DfE: the same table for 2021–2025 (Freedom of Information request)

**To:** Department for Education. Send it through the contact form at https://www.gov.uk/contact-dfe ("Make a Freedom of Information request").
**Subject:** FOI request: Year 6 → Year 7 destinations by school, London, 2021–2025

Dear Department for Education,

Under the Freedom of Information Act 2000, I request the following aggregated information for state-funded schools in London (Greater London local authorities):

For each of the school census years 2021, 2022, 2023, 2024 and 2025, a table with one row per pair of schools:

- the URN of the primary school the pupils attended in Year 6 (Spring census);
- the URN of the secondary school the same pupils attended in Year 7 the following year (Spring census);
- the number of pupils in that pair;
- the total number of Year 6 pupils at the primary school.

Please apply your usual statistical disclosure control. For example, the Greater London Authority's London Schools Atlas published this table for 2014–2016, with counts under 3 suppressed (London Datastore, "Feeder_Pri2Sec_2016_LDS.xlsx"). I would accept the same rule.

I would prefer the data in a machine-readable format (CSV or XLSX). Please also confirm that it may be re-used under the Open Government Licence.

If the full request exceeds the cost limit, please send the most recent year first and tell me how to narrow the request.

Yours faithfully,
[Your name]
[Postal or e-mail address for the reply]

---

### Notes

- **Response time:** an FOI reply is due within 20 working days.
- **If DfE refuses:** it may say this table is NPD-derived and can only be shared through its data sharing process (DSAP). In that case, ask for the aggregated table to be released under OGL, like the GLA's version.
- **Where pupils live:** the same Atlas also has `Catchments_PriSchooltoLSOA_2016` (where each school's pupils live, by LSOA, OGL v2). That is Locrating's "distribution of pupils" map. We could add it later in the same way.

---

## 3. The route that works: a DfE data share (researched 2026-10-16)

**Precedents:** the DfE external data shares register (Apr–Jun 2026, checked) lists:
- **DS00836 Locrating Ltd.** Census data 2022–2023, covering "which schools pupils attend and where they live", with "charts … showing which schools pupils have come from and which schools pupils move to". Delivered through the ONS Secure Research Service (SRS), reviewed every year.
- **DS01222 FFT for the Good Schools Guide.** Census data 2020/21–2024/25. The aggregated results are free on the Good Schools Guide website.
- **DS00503 GLA.** Includes the Schools Atlas, also through the SRS.

**Route:** the DfE Data Sharing Service, with work done inside the ONS SRS. Tables are disclosure-checked before they can leave. A Freedom of Information request (section 2) is unlikely to work: we found no example of DfE releasing NPD aggregates under FOI. Still worth sending, since it costs nothing.

**Prerequisites, in order:**
1. Incorporate a company. It becomes the data controller and signs the agreement.
2. Register with the ICO and pay the fee. The application form asks for the number.
3. Choose a lawful basis and write a DPIA, plus a Legitimate Interest Assessment if using legitimate interests.
4. Write a public benefit case, including the "commercial considerations" section.
5. Get a basic DBS check and ONS accredited researcher status for each analyst.
6. Fill in the DfE application form and the security questionnaire.
7. Get SRS project accreditation from ONS.

**Timeline and cost:**
- DfE estimates about 124 working days (roughly 6 months) for NPD access through the SRS.
- DfE lists no fee, and the SRS has no charge according to ADR UK. Not confirmed for commercial users.
- Other costs: the ICO fee and DBS checks.

**Risks:**
- The table must be rebuilt and checked inside the SRS every year.
- The minimum cell size is not confirmed (often 10 at ONS).
- The SRS is being replaced by a new secure platform.

**Sources:**
- [How to access DfE data extracts](https://www.gov.uk/guidance/how-to-access-department-for-education-dfe-data-extracts)
- [Application form guidance (Jul 2025)](https://assets.publishing.service.gov.uk/media/6878bc5d0263c35f52e4dd11/DfE_data_sharing_service_application_form_guidance_v2.0_July_2025.pdf)
- [Key datasets and timelines (Jun 2026)](https://assets.publishing.service.gov.uk/media/6a2a9924a3674dfd3eb506f2/How_to_apply_for_key_DfE_datasets_June_2026.pdf)
- [External data shares register](https://www.gov.uk/government/publications/dfe-external-data-shares)
