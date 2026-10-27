# Register with the ICO

Draft for the owner. Fees checked on ico.org.uk on 2026-10-27.

## When

After the Ltd exists. Register in the company's name, not your own: the company is the
controller. Do it before the site goes public (`CLOSE_KNIT_ACCESS=public`).

## Which tier and fee

**Tier 1 (micro): £52 a year, £47 by direct debit.**
Tier 1 covers a turnover of up to £632,000 **or** up to 10 staff. Close Knit has one person
and no turnover yet.

| Tier | Who | Fee |
|---|---|---|
| 1 micro | turnover ≤ £632,000 or ≤ 10 staff | £52 |
| 2 small/medium | turnover ≤ £36m or ≤ 250 staff | £78 |
| 3 large | everyone else (the ICO's default if you don't say) | £3,763 |

Direct debit takes £5 off. Renew every year.
Source: [Guide to the data protection fee](https://ico.org.uk/for-organisations/data-protection-fee/data-protection-fee/).

## Steps

1. Run the [self-assessment](https://ico.org.uk/for-organisations/data-protection-fee/data-protection-fee-self-assessment/).
   It should say "you need to pay": we publish address-level sale prices, and that is personal data.
2. Register at [ico.org.uk/fee](https://ico.org.uk/fee). The ICO says it takes about 15 minutes.
3. Pay by direct debit (£47).

## What to answer

| Question | Answer |
|---|---|
| Organisation name | The Ltd's exact name on Companies House |
| Company number, registered office | From the certificate of incorporation |
| Trading name | Close Knit |
| Type and sector | Private limited company. Online property and neighbourhood information (website, API, browser extension) |
| Staff | 1 |
| Turnover | Under £632,000 (none yet) |
| Contact for data protection | You, at the Ltd's address. Public e-mail: hello@getcloseknit.com |
| Data protection officer | None. A DPO is not required for us: no large-scale monitoring and no special-category data. Name yourself as the contact |
| CCTV (if asked) | No |
| Tier | Tier 1 |

The register of fee payers is public. It shows the company name and the registration number.

## Where the number goes

The number starts with Z, A or C, e.g. `ZB123456`.

1. `deploy/.env` on the server (never committed):
   ```
   CLOSE_KNIT_ICO_NUMBER=ZB123456
   CLOSE_KNIT_CONTROLLER="<Ltd legal name>, <registered office>"
   CLOSE_KNIT_CONTACT_EMAIL=hello@getcloseknit.com
   ```
   Ship (`deploy/ship.sh`). Then check:
   `curl -s https://<domain>/privacy | grep -o "ICO registration [A-Z0-9]*"`.
2. `docs/legal/ico-registration.md`, step 6: write the number and the date.
3. `RELEASE-CHECKLIST.md`, *Privacy and legal*: "ICO registration number recorded: ____".
4. `docs/legal/legitimate-interests-assessment.md`: the controller line at the top.
5. Diary: the renewal date, a year from payment.
