# VPS options, London, 8–16 GB RAM, x86-64 (checked 2026-10-01)

Workload: Docker Compose with PostGIS 18 (x86-64 only, ~8 GB DB), FastAPI, Next.js and Caddy, for UK users. Needs 8–16 GB RAM and at least 80 GB SSD.

**How to read this**
- Every provider publishes prices in USD, excluding VAT. UK business customers pay 20% VAT on top, or use reverse charge where it applies. No provider publishes GBP list prices. The **≈£ column is my own conversion at an assumed 0.75 GBP/USD and is not from a source.**
- Prices are monthly list prices. "Fits" means the plan has at least 80 GB local disk.
- The bracketed codes (e.g. [D1]) are source references; the full URLs are listed at the bottom. All figures come from official provider pages or official public APIs (Vultr and Linode `/plans` and `/types` endpoints).
- vCPU types: "sh" means shared vCPU and "ded" means dedicated vCPU.

## 1. Compute plans in London

| Provider / plan (slug) | vCPU | RAM | Disk | Transfer incl. | Overage | US$/mo | ≈£/mo | ≥80 GB? | London | Src |
|---|---|---|---|---|---|---|---|---|---|---|
| **DigitalOcean (LON1)** | | | | | | | | | | |
| Basic Regular `s-4vcpu-8gb` | 4 sh | 8 | 160 | 5,000 GiB | $0.01/GiB | 48 | 36 | ✓ | ✓ Basic | D1 D2 D3 |
| Basic Premium AMD `s-2vcpu-8gb-amd` | 2 sh | 8 | 100 | 5,000 GiB | $0.01/GiB | **42** | 31.5 | ✓ | Basic ✓ (Premium per-region not stated) | D1 D3 |
| Basic Premium AMD `s-4vcpu-8gb-amd` | 4 sh | 8 | 160 | 5,000 GiB | $0.01/GiB | 56 | 42 | ✓ | as above | D1 |
| Basic Premium AMD `s-4vcpu-16gb-amd` | 4 sh | 16 | 200 | 8,000 GiB | $0.01/GiB | 84 | 63 | ✓ | as above | D1 |
| Basic Premium Intel `s-2vcpu-8gb-160gb-intel` | 2 sh | 8 | 160 | 5,000 GiB | $0.01/GiB | 48 | 36 | ✓ | as above | D1 |
| Basic Premium Intel `s-4vcpu-16gb-320gb-intel` | 4 sh | 16 | 320 | 8,000 GiB | $0.01/GiB | 96 | 72 | ✓ | as above | D1 |
| Basic Regular `s-8vcpu-16gb` | 8 sh | 16 | 320 | 6,000 GiB | $0.01/GiB | 96 | 72 | ✓ | ✓ | D1 |
| General Purpose `g-2vcpu-8gb` / `gd-` (2x SSD) | 2 ded | 8 | 25 / 50 | 4,000 GiB | $0.01/GiB | 63 / 68 | 47 / 51 | ✗ | ✓ | D1 |
| General Purpose `g6_5-2vcpu-8gb` | 2 ded | 8 | 163 | 4,000 GiB | $0.01/GiB | 90.60 | 68 | ✓ | ✓ | D1 |
| General Purpose `gd-4vcpu-16gb` | 4 ded | 16 | 100 | 5,000 GiB | $0.01/GiB | 136 | 102 | ✓ | ✓ | D1 |
| CPU-Opt `c2-4vcpu-8gb` | 4 ded | 8 | 100 | 5,000 GiB | $0.01/GiB | 94 | 70.5 | ✓ | ✓ | D1 |
| Memory-Opt `m-2vcpu-16gb` / `m3-` | 2 ded | 16 | 50 / 150 | 4,000 GiB | $0.01/GiB | 84 / 104 | 63 / 78 | ✗ / ✓ | ✓ | D1 |
| v5 `g5-2vcpu-8gb-50gb` (hourly, no cap) | 2 ded | 8 | 50 | 4,000 GiB | — | 70.81 | — | ✗ | **✗ not in LON1** | D1 D3 |
| **Vultr (London `lhr`; Manchester `man` also exists)** | | | | | | | | | | |
| Cloud Compute Regular `vc2-4c-8gb` (Intel) | 4 sh | 8 | 160 | 4 TB | $0.01/GB | **40** | 30 | ✓ | ✓ | V1 V2 |
| Cloud Compute Regular `vc2-6c-16gb` | 6 sh | 16 | 320 | 5 TB | $0.01/GB | 80 | 60 | ✓ | ✓ | V1 V2 |
| High Performance `vhp-4c-8gb-amd`/`-intel` (NVMe) | 4 sh | 8 | 180 | 6 TB | $0.01/GB | 48 | 36 | ✓ | ✓ | V1 V2 |
| High Performance `vhp-8c-16gb-amd`/`-intel` | 8 sh | 16 | 350 | 8 TB | $0.01/GB | 96 | 72 | ✓ | ✓ | V1 V2 |
| High Frequency `vhf-3c-8gb` | 3 sh | 8 | 256 | 4 TB | $0.01/GB | 48 | 36 | ✓ | ✓ | V1 V2 |
| High Frequency `vhf-4c-16gb` | 4 sh | 16 | 384 | 5 TB | $0.01/GB | 96 | 72 | ✓ | ✓ | V1 V2 |
| Optimized General Purpose `voc-g-2c-8gb-50s` | 2 ded | 8 | 50 | 5 TB | $0.01/GB | 60 | 45 | ✗ | ✓ | V1 V2 |
| Optimized General Purpose `voc-g-4c-16gb-80s` | 4 ded | 16 | 80 | 6 TB | $0.01/GB | 120 | 90 | ✓ (just) | ✓ | V1 V2 |
| Optimized Memory `voc-m-2c-16gb-100s` | 2 ded | 16 | 100 | 6 TB | $0.01/GB | **80** | 60 | ✓ | ✓ | V1 V2 |
| Optimized CPU `voc-c-4c-8gb-150s` | 4 ded | 8 | 150 | 6 TB | $0.01/GB | 90 | 67.5 | ✓ | ✓ | V1 V2 |
| Optimized Storage `voc-s-1c-8gb-150s` | 1 ded | 8 | 150 | 4 TB | $0.01/GB | 75 | 56 | ✓ | ✓ | V1 V2 |
| VX1 `vx1-g-2c-8g-120s` (AMD; local + block storage) | 2 (type not stated) | 8 | 120 | 5 TB | $0.01/GB | 55.48 | 41.6 | ✓ | ✓ | V1 V2 |
| VX1 `vx1-m-2c-16g-120s` | 2 (type not stated) | 16 | 120 | 5 TB | $0.01/GB | 70.08 | 52.6 | ✓ | ✓ | V1 V2 |
| **Akamai / Linode (London 2 `gb-lon`; legacy `eu-west` has only G6 plans)** | | | | | | | | | | |
| Shared `g6-standard-4` "Linode 8 GB" | 4 sh | 8 | 160 | 5 TB | $0.005/GB | 48 | 36 | ✓ | ✓ both | A1 A2 A3 |
| Shared `g6-standard-6` "Linode 16 GB" | 6 sh | 16 | 320 | 8 TB | $0.005/GB | 96 | 72 | ✓ | ✓ both | A1 A2 A3 |
| G6 Dedicated 8 GB `g6-dedicated-4` | 4 ded | 8 | 160 | 5 TB | $0.005/GB | **72** | 54 | ✓ | ✓ both | A1 A2 A3 |
| G6 Dedicated 16 GB `g6-dedicated-8` | 8 ded | 16 | 320 | 6 TB | $0.005/GB | 144 | 108 | ✓ | ✓ both | A1 A2 A3 |
| G7 Dedicated / Premium 8 GB | 4 ded | 8 | 160 | 5 TB | $0.005/GB | 86 | 64.5 | ✓ | gb-lon only | A1 A2 A3 |
| G7 Dedicated / Premium 16 GB | 8 ded | 16 | 320 | 6 TB | $0.005/GB | 173 | 130 | ✓ | gb-lon only | A1 A2 A3 |
| G8 Dedicated 8x2 (hourly $0.11, **no cap**) | 2 ded | 8 | 80 | **0 TB** | $0.005/GB | ≈80.30 (730 h) | 60 | ✓ (just) | gb-lon only | A1 A2 A3 A4 |
| G8 Dedicated 8x4 ($0.14/h) | 4 ded | 8 | 80 | 0 TB | $0.005/GB | ≈102.20 | 77 | ✓ (just) | gb-lon only | A1 A2 A3 A4 |
| G8 Dedicated 16x4 ($0.21/h) | 4 ded | 16 | 160 | 0 TB | $0.005/GB | ≈153.30 | 115 | ✓ | gb-lon only | A1 A2 A3 A4 |
| **AWS Lightsail (London `eu-west-2`), reference only** | | | | | | | | | | |
| General Purpose 8 GB (IPv4) | 2, burstable | 8 | 160 | 5 TB (inbound also counts) | $0.09/GB | 44 (IPv6-only: 40) | 33 | ✓ | ✓ | L1 L3 |
| General Purpose 16 GB (IPv4) | 4, burstable | 16 | 320 | 6 TB | $0.09/GB | 84 (IPv6-only: 80) | 63 | ✓ | ✓ | L1 L3 |
| Memory Optimized 16 GB | 2 | 16 | 160 | 5 TB | $0.09/GB | 74 (IPv6-only: 70) | 55.5 | ✓ | ✓ | L1 |
| Compute Optimized 8 GB | 4 | 8 | 320 | 6 TB | $0.09/GB | 84 | 63 | ✓ | ✓ | L1 |
| Compute Optimized 16 GB | 8 | 16 | 640 | 7 TB | $0.09/GB | 168 | 126 | ✓ | ✓ | L1 |

## 2. Backups and snapshots

| Provider | Automated backups | Snapshots | Src |
|---|---|---|---|
| DigitalOcean | 20% of Droplet price for weekly backups, 30% for daily (e.g. $42 plan: +$8.40 or +$12.60). Usage-based backups from $0.01/GiB-mo, every 4 h, 3 d–6 mo retention | $0.06/GB-mo | D1 |
| Vultr | +20% of the instance price | $0.05/GB-mo ("subject to change") | V2 |
| Akamai/Linode | Flat fee: 8 GB shared or G6/G7 = $10/mo; 16 GB = $20/mo; G8 8 GB = $4.92/mo; G8 16 GB = $9.84/mo | (backup service only) | A1 |
| Lightsail | Automatic and manual snapshots both billed at $0.05/GB-mo | $0.05/GB-mo | L1 |

## 3. Managed Postgres for a ~10 GB database (alternative to self-hosting PostGIS)

| Provider | Cheapest viable plan | Price/mo (single node) | PostGIS | PG 18 | Src |
|---|---|---|---|---|---|
| DigitalOcean | 1 GiB/1 vCPU, 10–30 GiB disk: $15.15 + $0.215/GiB above the base. More realistic: 2 GiB/30 GiB at $30.45, or 4 GiB/60 GiB at $60.90 | 15.15–60.90 | ✓ (postgis, raster, topology, h3_postgis listed for PG 18) | ✓ | D4 D5 D6 |
| Vultr | High Performance 1 GB/32 GB $18; 2 GB/64 GB $36; 4 GB/128 GB $72 | 18–72 | ✓ "PostGIS extension package is already installed" | "13 to the latest" | V2 V3 V4 |
| Akamai/Linode | Shared 1 GB/9 GB $16; 2 GB/30 GB $32; 4 GB/58 GB $63 | 16–63 | Not stated by Akamai (its docs point to Aiven's extension list) | ✓ (engine `postgresql/18` in the API) | A2 A5 A6 |
| Lightsail | 1 GB/40 GB $15; 2 GB/80 GB $30; 4 GB/120 GB $60 (HA plans cost double) | 15–60 | **Not documented** | The FAQ lists only PG ≤12 (outdated page) | L1 L4 |

## 4. DPA / UK GDPR

| Provider | Terms | Src |
|---|---|---|
| DigitalOcean | The DPA is an addendum to the Customer ToS. It names the UK and includes the UK IDTA Addendum to the EU SCCs (Schedule 4). | D7 |
| Vultr | The DPA is available **on request** (via a Console ticket or your account manager). The page names "EU GDPR"; UK coverage is not stated, so confirm it when you request the DPA. | V5 |
| Akamai/Linode | The DPA is "incorporated into" Akamai's T&Cs and covers Cloud Computing Services. Transfers are covered by EU SCCs plus the Trust Center Data Transfer Statement; Akamai is certified under the DPF UK Extension. | A7 |
| AWS Lightsail | The AWS DPA plus a UK GDPR Addendum (SCCs + IDTA) are part of the Service Terms and apply automatically. | L5 |

## 5. Caveats

- **DigitalOcean:** The docs region matrix lists the Basic, General Purpose, CPU-Optimized, Memory-Optimized and Storage-Optimized families in LON1, but **v5 is not available there**. It does not say which regions have the Premium AMD/Intel variants, so check in the control panel. From 15 Oct 2026 (new accounts) and 30 Nov 2026 (all accounts), new Standard Edition managed PG clusters are limited to 4 GiB RAM or less. Advanced Edition starts at $130. The transfer allowance is pooled across the team. [D3][D4][D2]
- **Akamai:** G8 plans include **no transfer allowance**, so every GB of egress costs $0.005. Since 1 Jul 2026 they are billed hourly with no monthly cap, so a 31-day month costs more than the 730-hour figure shown. Akamai describes G6 as "legacy hardware". [A1][A4]
- **Vultr:** "certain global data center locations may have different … pricing", and the current price for a given location is shown only in the Control Panel. The website blocks scripted access, so plan specs here come from the official public API, and the Regular $40 tier was cross-checked against the pricing page. Whether VX1 vCPUs are shared or dedicated is not stated. [V1][V2]
- **Lightsail:** Instances are burstable, with a CPU burst-capacity metric. Inbound traffic counts toward the transfer allowance. Overage costs $0.09/GB, about 9–18× the other providers. [L1][L2]
- **Disk:** A PostGIS DB of about 8 GB plus Docker images, WAL and dumps fits comfortably in 160 GB. Plans with 50 GB disks would need block storage added, which is not priced here except Lightsail at $0.10/GB-mo [L1] and Akamai at $0.10/GB-mo ($8 for 80 GB) [A1].

## Sources

- D1 https://www.digitalocean.com/pricing/droplets (plan data embedded in page; backups 20%/30%; snapshots $0.06/GB)
- D2 https://docs.digitalocean.com/platform/billing/bandwidth/ ($0.01/GiB overage, pooled)
- D3 https://docs.digitalocean.com/platform/regional-availability/ (LON1 matrix)
- D4 https://docs.digitalocean.com/products/databases/postgresql/details/pricing/
- D5 https://www.digitalocean.com/pricing/managed-databases
- D6 https://docs.digitalocean.com/products/databases/postgresql/details/supported-extensions/
- D7 https://www.digitalocean.com/legal/data-processing-agreement
- V1 https://api.vultr.com/v2/plans and https://api.vultr.com/v2/regions/lhr/availability (official public API)
- V2 https://www.vultr.com/pricing/ (FAQ: backups +20%, snapshots $0.05/GB, overage $0.01/GB, regional pricing note; managed PG tables)
- V3 https://docs.vultr.com/products/managed-database/postgresql/faq
- V4 https://docs.vultr.com/how-to-install-the-postgis-extension-for-postgresql
- V5 https://docs.vultr.com/support/platform/compliance/does-vultr-offer-a-data-processing-addendum
- A1 https://www.akamai.com/cloud/pricing/europe (London listed; egress overage $0.005/GB; plan and DB tables)
- A2 https://api.linode.com/v4/linode/types , https://api.linode.com/v4/databases/types , https://api.linode.com/v4/databases/engines
- A3 https://api.linode.com/v4/regions/gb-lon/availability and …/eu-west/availability
- A4 https://techdocs.akamai.com/cloud-computing/docs/understanding-how-billing-works
- A5 https://techdocs.akamai.com/cloud-computing/docs/aiven-postgresql
- A6 https://api.linode.com/v4/databases/engines
- A7 https://www.akamai.com/site/en/documents/corporate/akamai-data-protection-addendum.pdf ; https://www.akamai.com/legal/data-privacy-framework-policy-statement
- L1 https://aws.amazon.com/lightsail/pricing/
- L2 https://docs.aws.amazon.com/lightsail/latest/userguide/viewing-instance-burst-capacity.html
- L3 https://aws.amazon.com/lightsail/pricing/ (region overage table, Europe (London) $0.09/GB)
- L4 https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-faq-databases.html
- L5 https://aws.amazon.com/compliance/gdpr-center/

## Recommendation

**Top pick: Akamai/Linode G6 Dedicated 8 GB in London (`gb-lon`), $72/mo + $10 backups.** It gives 4 dedicated vCPUs, a 160 GB disk and 5 TB of transfer, and has the cheapest overage ($0.005/GB). The flat monthly price is capped. It is available in both London DCs. Its DPA is auto-incorporated and covers the UK.

- **Budget alternative:** DO Premium AMD `s-2vcpu-8gb-amd` at $42 (+$8.40 weekly backups). It has the clearest UK IDTA DPA, but shared CPU, and you need to confirm Premium AMD availability in LON1.
- **More RAM:** Vultr `voc-m-2c-16gb-100s` at $80 gives 16 GB with dedicated vCPUs, but its DPA is on request only.
