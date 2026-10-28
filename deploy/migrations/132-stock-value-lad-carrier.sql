-- 132: a stock value restated by its LAD's index names the carrier 'lad'.
-- rebuild_stock_values() reads the carrier kind from the carrier id, which is uk:lad:<code> since 129, so the
-- old check (lsoa, msoa, borough) refused every LAD-carried row and the sales and £/m² rebuilds failed.
-- Rows written before 129 say 'borough' and are renamed. Safe to run again.

ALTER TABLE property_stock_value DROP CONSTRAINT IF EXISTS property_stock_value_index_carrier_check;
UPDATE property_stock_value SET index_carrier = 'lad' WHERE index_carrier = 'borough';
ALTER TABLE property_stock_value ADD CONSTRAINT property_stock_value_index_carrier_check
    CHECK (index_carrier IN ('lsoa', 'msoa', 'lad'));
