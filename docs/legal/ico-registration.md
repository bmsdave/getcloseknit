# ICO registration checklist (deployment step, user action)

Organisations that process personal data in the UK usually have to pay the
data protection fee and register with the Information Commissioner's Office.
Publishing address-level sale prices counts as processing personal data.

1. Check whether you are exempt: https://ico.org.uk/for-organisations/data-protection-fee/self-assessment/
   (a not-for-profit or purely personal use may be exempt; a public website
   run by a business generally is not).
2. Register / pay the fee in the Ltd's name: https://ico.org.uk/fee — tier 1
   (micro), £52 a year or £47 by direct debit (checked 2026-10-27). Answers to
   give: `docs/legal/owner-pack/ico-steps.md`.
3. Record the registration number in the deployment environment so the
   privacy notice shows it:
   `CLOSE_KNIT_ICO_NUMBER=Zxxxxxxx`, together with
   `CLOSE_KNIT_CONTROLLER="<legal name>"` and
   `CLOSE_KNIT_CONTACT_EMAIL=<privacy contact>`.
4. Keep the signed LIA (`legitimate-interests-assessment.md`) with your
   records of processing.
5. Set up the objection channel before going public:
   `CLOSE_KNIT_SMTP_*` for confirmation e-mails and/or
   `CLOSE_KNIT_CORRECTIONS_WEBHOOK` for operator notifications; test the
   flow end to end (RELEASE-CHECKLIST.md).
6. Add the ICO number to `RELEASE-CHECKLIST.md` when done.
