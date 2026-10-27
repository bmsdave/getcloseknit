# EU budget VPS pricing for a PostGIS/FastAPI/Next.js stack serving UK users (checked 2026-10-01)

Requirements: x86-64, 8–16 GB RAM, at least 80 GB SSD/NVMe, Docker Compose, about 8 GB PostGIS database, UK users.
Sources are official provider pages only. Prices are monthly, **ex VAT**. Bracketed codes such as [H1] point to the source list at the bottom.

## Hetzner Cloud: hourly billing, no UK data centre

The prices below come from Hetzner's own price API, which hetzner.com uses to render the plan pages ([H6]). They **include the €0.50/mo primary IPv4** ([H7]). Without the IPv4 address they match the "new price" column of the price-adjustment table in [H5], so they are ex VAT.

| Plan | vCPU | RAM | Disk | Traffic incl. / overage | €/mo (ex VAT, incl. IPv4) | Hourly | EU locations | Src |
|---|---|---|---|---|---|---|---|---|
| CX33 (Cost-Optimized) | 4 shared, Intel/AMD | 8 GB | 80 GB NVMe | 20 TB / €1.00 per TB | **€8.99** | €0.0144/h | FSN1, NBG1, HEL1 | [H1][H6] |
| CX43 (Cost-Optimized) | 8 shared, Intel/AMD | 16 GB | 160 GB NVMe | 20 TB / €1.00 per TB | **€16.49** | €0.0264/h | FSN1, NBG1, HEL1 | [H1][H6] |
| CPX32 (Regular Perf.) | 4 shared, AMD | 8 GB | 160 GB NVMe | 20 TB / €1.00 per TB | **€35.99** | €0.0577/h | FSN1, NBG1, HEL1 | [H2][H6] |
| CPX42 (Regular Perf.) | 8 shared, AMD | 16 GB | 320 GB NVMe | 20 TB / €1.00 per TB | **€69.99** | €0.1122/h | FSN1, NBG1, HEL1 | [H2][H6] |
| CCX13 (General Purpose) | 2 **dedicated**, AMD | 8 GB | 80 GB NVMe | 20 TB / €1.00 per TB | **€43.49** | €0.0697/h | FSN1, NBG1, HEL1 (plus US and SIN) | [H3][H6] |
| CCX23 (General Purpose) | 4 **dedicated**, AMD | 16 GB | 160 GB NVMe | 20 TB / €1.00 per TB | **€86.49** | €0.1386/h | FSN1, NBG1, HEL1 (plus US and SIN) | [H3][H6] |

- **Hourly billing:** yes, with a monthly cap ([H3]).
- **UK/London location:** none. The nearest are Falkenstein and Nuremberg in Germany and Helsinki in Finland ([H1]).
- **Backups:** 20% of the instance price, with 7 daily slots ([H2]: the page multiplies the instance price by 0.2; [H8]). For CX43 that is about €3.30/mo.
- **Snapshots:** €0.0143 per GB per month ([H1]: the price for product key CLOUD_24 in [H6]).
- **Traffic overage:** €1.00 per TB in the EU and €7.40 per TB in Singapore (CLOUD_66 in [H6], labelled on [H3]).
- **DPA:** self-service Art. 28 GDPR DPA in the account at accounts.hetzner.com/account/dpa ([H9]).
- **2026 price changes:**
  - On 1 Apr 2026 Hetzner raised prices for new orders **and existing products** ([H10]).
  - On 15 Jun 2026 it raised prices again for new orders and rescales ([H4], [H5]). Examples: CPX32 went from €13.99 to €35.49, CCX13 from €15.99 to €42.99 and CX43 from €11.99 to €15.99, all excluding IPv4.
  - The CX line now offers by far the most RAM per euro.
- **Stock:** the Cost-Optimized page says the "number of available servers is limited" ([H1]). In my headless render every plan showed "currently unavailable", but the price widgets also failed to load. The price API lists every location as `active:true`, so check stock in the Console before relying on this.
- **No setup fee and no minimum term.**
- **Dedicated servers under €60:**
  - Server Auction: the cheapest machine is **€64 plus €1.70 IPv4 = €65.70/mo**. Of 172 listings, none is at or below €60 ([H11], [H12]).
  - EX44-1-LTD and AX41-1-LTD cost €57.30 + IPv4 with €0 setup, but they are a "limited offering" that appears only when cheap hardware is available ([H5]). Neither is listed in the current Server Finder, whose cheapest entry is AX42 ([H13]).
  - The regular AX42-1 costs €97.30 ([H5]).
  - **Result: no Hetzner dedicated server under €60 right now.**

## Netcup: KVM vServers, term contracts, no UK data centre

Netcup's site shows prices **including 19% German VAT**. The net figures below are the shown price divided by 1.19. The shown gross price is in brackets.

| Plan | vCPU | RAM | Disk | Traffic | 1-mo term | 12-mo term | 24-mo term | Locations | Src |
|---|---|---|---|---|---|---|---|---|---|
| VPS 1000 G12.5 | 4 vCore, shared x86 | 8 GB ECC | 128 GB SSD | Flat rate. Throttled to 200 Mbit/s if the 24 h average exceeds 2 TB | €14.02 (€16.68) | €12.18 (€14.50) | **€10.35** (€12.32) | Any EU (AT/DE/NL) free. Pinning to AMS, NUE or VIE costs extra; MNZ (US) and SIN also offered | [N2][N4] |
| VPS 2000 G12.5 | 8 vCore, shared x86 | 16 GB ECC | 256 GB SSD | Same as VPS 1000 | €26.02 (€30.96) | €22.62 (€26.92) | **€19.24** (€22.89) | Same as VPS 1000. Pinning to a specific location costs +€3.43 gross | [N2][N5] |
| RS 1000 G12.5 | 4 **dedicated**, AMD EPYC 9645 | 8 GB | 128 GB NVMe | Flat rate. Throttled to 300 Mbit/s above 3 TB in 24 h | €21.01 (€25.00) | €18.26 (€21.73) | **€15.52** (€18.47) | Any EU free. NUE, VIE, MNZ: +€2.78 gross. SIN: +€15.57 | [N1][N3] |
| RS 2000 G12.5 | 8 **dedicated**, AMD EPYC 9645 | 16 GB | 256 GB NVMe | Same as RS 1000 | €39.34 (€46.81) | €34.20 (€40.70) | **€29.08** (€34.60) | Same as RS 1000 | [N1][N6] |

- **Billing:** no hourly billing. You pick a 1-, 12- or 24-month term. The 12-month term is 13% cheaper than 1 month and the 24-month term 26% cheaper (27% for VPS 1000). The 24-month term bills 24 months at once ([N3]).
- **Setup fee:** €0 ([N3], [N6]).
- **Traffic:** a flat rate, with throttling instead of overage charges ([N3], [N4]).
- **Disk expansion:** Local Block Storage costs €0.01 per GB per month ([N2]).
- **Backups and snapshots:** copy-on-write snapshots are included ([N3]). The page shows no priced automatic-backup product.
- **UK/London location:** none.
- **DPA:** free, created in the Customer Control Panel under Master Data → Order Processing ([N7]).
- **2026 price change:** from **September 2026**, prices for new orders of Root Server and VPS rose ([N8]). The netcup forum reports up to +40% for VPS and +70–110% for RS (forum post, not an official page). Existing contracts keep their old prices ([N8]).
- **Contract terms:**
  - VPS plans have **no** satisfaction guarantee and no 99.9% availability SLA. RS plans have both ([N2]).
  - RS plans come with a 30-day money-back guarantee ([N1]).

## Contabo: monthly terms, UK region in Portsmouth (not London)

Contabo's EUR list prices are ex VAT. Contabo's own blog states €5.24 including 19% VAT for the €4.40 Core VPS 4 price ([C8]). The GBP figures were read from a UK-locale render of the configurator, where the order summary shows "+ 20% VAT".

| Plan | vCPU | RAM | Disk | Traffic | €/mo 1-mo / 12-mo / 24-mo (ex VAT) | £/mo 1-mo / 24-mo (ex VAT) | UK region surcharge | Auto Backup / snapshots | Src |
|---|---|---|---|---|---|---|---|---|---|
| Cloud VPS **Core 4** | 4 shared, CPU unspecified | 8 GB | 100 GB SSD (200 GB SSD +€1.50) | "Unlimited", fair use, 200 Mbit/s port | €5.50 / €4.68 / **€4.40** | £5.40 / £4.32 | **+£1.05/mo** ex VAT (£1.26 incl.) | €1.65/mo; 1 snapshot | [C1][C3] |
| Cloud VPS **Core 6** | 6 shared | 12 GB | 200 GB SSD, or 100 GB NVMe at no extra cost | Unlimited, fair use, 300 Mbit/s | €7.50 / €6.38 / **€6.00** | £7.35 / £5.88 | **+£1.60/mo** ex VAT (£1.92 incl.) | €3.35/mo; 2 snapshots | [C1][C4] |
| Cloud VPS **Plus 4** (Performance) | 4 shared, AMD EPYC (latest gen) | 8 GB | 150 GB NVMe | Unlimited, fair use, 500 Mbit/s | €13.50 / – / **€10.80** | £13.00 / £10.40 | **+£3.05/mo** ex VAT (£3.66 incl.) | Auto Backup with 3 months free (price not captured); 5 snapshots | [C2][C5] |
| Cloud VPS **Plus 6** (Performance) | 6 shared, AMD EPYC | 12 GB | 300 GB NVMe | Unlimited, fair use, 500 Mbit/s | €19.00 / – / **€15.20** | £18.25 / £14.60 | **+£4.35/mo** ex VAT (£5.22 incl.) | €5.00/mo with 3 months free; 5 snapshots | [C2][C6] |
| (ref) Cloud VDS S (Max Perf.) | 6 **dedicated**, EPYC 7282 | 24 GB (above the 16 GB range) | 180 GB NVMe | Unlimited, fair use, 250 Mbit/s | €49.00 / – / **€39.20** | – | not captured | – | [C7] |

- **Billing:** no hourly billing. Terms run 1, 3, 6, 12 or 24 months. The 12-month term saves 15% and the 24-month term 20%. Every term shows "No Setup Fee" ([C3], [C4]).
- **Locations:** 9 regions in 11 locations, including the EU and the UK ([C1]).
- **UK data centre:** in **Portsmouth**, with network connectivity through Aptum. Contabo quotes about 3 ms ping to London ([C9]).
- **Traffic:** "Unlimited – fair usage policy". Contabo may throttle servers with exceptionally high usage, and there is no overage price ([C1]).
- **DPA:** self-service in the Customer Control Panel under DPA → Create new Data Processing Agreement ([C10]).
- **2026 changes:**
  - On 29 Jul 2026 Contabo split its range into Core, Performance and Max Performance ([C11]). Core is the old Cloud VPS line on "proven hardware" with shared vCPUs. Performance runs shared vCPUs on newer EPYC hardware. Max Performance has dedicated CPU and RAM.
  - Existing customers keep their current plans.
- **Contention:** Contabo itself says shared VPS resources "can sometimes lead to resource contention" ([C7]).

## Noisy-neighbour reputation

These notes are **not** from official pages. They are widely reported community experience, and I did not verify them.

- **Contabo Core** has a long-standing reputation for heavy oversubscription, high CPU steal and variable disk IOPS. Performance and VDS are the plans meant to address this.
- **Hetzner** shared plans (CX/CPX) are generally well regarded, with occasional steal on busy hosts. CCX plans have dedicated cores.
- **Netcup VPS** uses shared "fair share" vCores. Netcup RS cores are dedicated and usually consistent, although the forum has threads complaining about RS performance.

## Fit summary for this workload

The workload is a PostGIS database of about 8 GB, so 16 GB RAM is preferable because it lets the database fit in the page cache.

| Option | €/mo ex VAT | RAM / disk | Why consider it | Main risk |
|---|---|---|---|---|
| Hetzner CX43 + backups | about €19.80 | 16 GB / 160 GB NVMe | Hourly billing, 20 TB traffic, snapshots, mature API and Terraform support | Shared vCPU, limited stock, no UK location (Germany adds about 15–25 ms) |
| Netcup RS 2000, 12-mo term | €34.20 | 16 GB / 256 GB NVMe | 8 dedicated EPYC 9645 cores give the most predictable performance for PostGIS | 12-month lock-in, no hourly billing, no backup product |
| Netcup VPS 2000, 12-mo term | €22.62 | 16 GB / 256 GB SSD | Cheap 16 GB | Shared cores, no SLA |
| Contabo Plus 6, UK | about £18.25 + £4.35 per month on a 1-month term, or about £18.95 on a 24-month term | 12 GB / 300 GB NVMe | Only option with UK data residency (Portsmouth) | Only 12 GB RAM, fair-use traffic, contention reputation |

## Sources

- [H1] https://www.hetzner.com/cloud/cost-optimized
- [H2] https://www.hetzner.com/cloud/regular-performance
- [H3] https://www.hetzner.com/cloud/general-purpose
- [H4] https://www.hetzner.com/pressroom/standardization-and-price-adjustment-of-our-server-products/
- [H5] https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
- [H6] https://website-price-api.hetzner.com/api/v1/products/CLOUD_133%2BCLOUD_21. This is the endpoint pattern hetzner.com calls. The IDs are CX33=133, CX43=134, CPX32=126, CPX42=128, CCX13=115, CCX23=116, snapshots=CLOUD_24 and traffic=CLOUD_66.
- [H7] https://website-price-api.hetzner.com/api/v1/products/CLOUD_21 (primary IPv4, €0.50/mo)
- [H8] https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/
- [H9] https://www.hetzner.com/news/auftragsverarbeitung (DPA)
- [H10] https://www.hetzner.com/pressroom/statement-price-adjustment/
- [H11] https://www.hetzner.com/sb/
- [H12] https://www.hetzner.com/_resources/app/data/app/live_data_sb.json (the auction data feed used by /sb/)
- [H13] https://www.hetzner.com/dedicated-rootserver/
- [N1] https://www.netcup.com/en/server/root-server
- [N2] https://www.netcup.com/en/server/vps
- [N3] https://www.netcup.com/en/server/root-server/rs-1000-g12.5-iv-24m-eu
- [N4] https://www.netcup.com/en/server/vps/vps-1000-g12.5-iv-24m-eu
- [N5] https://www.netcup.com/en/server/vps/vps-2000-g12.5-iv-24m-eu
- [N6] https://www.netcup.com/en/server/root-server/rs-2000-g12.5-iv-24m-eu
- [N7] https://helpcenter.netcup.com/en/wiki/general/dpa
- [N8] https://www.netcup.com/en/priceadjustment
- [C1] https://contabo.com/en/vps/
- [C2] https://contabo.com/en/vps-performance/
- [C3] https://contabo.com/en/vps/cloud-vps-core-4
- [C4] https://contabo.com/en/vps/cloud-vps-core-6
- [C5] https://contabo.com/en/vps/cloud-vps-plus-4
- [C6] https://contabo.com/en/vps/cloud-vps-plus-6
- [C7] https://contabo.com/en/vds/
- [C8] https://contabo.com/blog/best-budget-vps-developers/ (search snippet: "Core VPS 4 … €5.24/month … incl. VAT")
- [C9] https://contabo.com/en/locations/united-kingdom/
- [C10] https://docs.contabo.com/docs/products/dpa/what-is/
- [C11] https://contabo.com/blog/introducing-the-new-contabo-vps-portfolio-core-performance-and-max-performance/

## Not verified

- Live stock in the Hetzner Console. This would need a login, which I did not do.
- Contabo's UK surcharge in EUR. I captured it only in GBP.
- The price of Auto Backup on Contabo Plus 4.
- Netcup's exact pre-September prices.
- The CPU model behind Netcup VPS and Contabo Core plans.
