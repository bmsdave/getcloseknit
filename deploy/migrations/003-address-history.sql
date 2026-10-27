-- 003: address-level sale history backing per-building histories.
--
-- HMLR transactions carry no UPRN, so addresses are identified by a stable
-- hash of postcode + normalized address key (cautious-address fallback, never
-- a real UPRN). Coordinates are ONSPD postcode grid references: postcode
-- precision, never building precision. Prices are achieved completion prices,
-- never valuations or estimates.

CREATE TABLE address (
    id text PRIMARY KEY CHECK (id ~ '^uk:addr:[0-9a-f]{12}$'),
    display_address text NOT NULL,
    postcode text NOT NULL,
    geography_id text NOT NULL REFERENCES area_geography(id),
    easting integer CHECK (easting IS NULL OR easting > 0),
    northing integer CHECK (northing IS NULL OR northing > 0),
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE INDEX address_postcode_idx ON address (postcode);
CREATE INDEX address_geography_idx ON address (geography_id);

CREATE TABLE address_transaction (
    address_id text NOT NULL REFERENCES address(id),
    sale_month date NOT NULL,
    completion_date date NOT NULL,
    nominal_price integer NOT NULL CHECK (nominal_price > 0),
    floor_area_square_metres double precision CHECK (floor_area_square_metres IS NULL OR floor_area_square_metres > 0),
    price_per_square_metre double precision CHECK (price_per_square_metre IS NULL OR price_per_square_metre > 0),
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (address_id, completion_date, nominal_price)
);

CREATE INDEX address_transaction_month_idx ON address_transaction (sale_month);
