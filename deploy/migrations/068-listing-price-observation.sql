-- 068: Asking prices the browser extension has seen on portal listings (api/area_api/listing_history.py).
--
--   listing_price_observation  one row per listing and day: the portal, its own listing id, the asking
--                              price on the page (£, or £ a month to rent) and the day it was seen. The
--                              first sighting of a day is kept. Nothing about who viewed it is stored.
--
-- Written and read only when CLOSE_KNIT_LISTING_HISTORY=1 (feature_flags.py), which stays off in
-- production until the privacy / legal review. Safe to run again.

CREATE TABLE IF NOT EXISTS listing_price_observation (
    portal text NOT NULL CHECK (portal IN ('rightmove', 'zoopla', 'onthemarket', 'spareroom', 'openrent')),
    listing_id text NOT NULL CHECK (listing_id ~ '^[A-Za-z0-9_-]{1,40}$'),
    observed_on date NOT NULL,
    price integer NOT NULL CHECK (price > 0 AND price < 100000000),
    PRIMARY KEY (portal, listing_id, observed_on)
);
