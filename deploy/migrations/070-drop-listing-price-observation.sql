-- 070: Drop the extension's shared asking-price history (table from 068).
--
-- Owner decision 2026-10-18 (docs/superpowers/specs/2026-10-18-extension-legal-strategy.md §1 "Never",
-- §6 item 6): we never store portal listings, their prices or photos. CLOSE_KNIT_LISTING_HISTORY and
-- api/area_api/listing_history.py are removed; the table was never written in production (flag off).
-- Safe to run again.

DROP TABLE IF EXISTS listing_price_observation;
