"""Privacy objections keep only hashes, need a dwelling key, and suppress via a view."""
import unittest
from pathlib import Path

MIGRATION = (Path(__file__).resolve().parents[1] / "migrations" / "007-property-objection.sql").read_text()


class ObjectionSchemaTests(unittest.TestCase):
    def test_objection_rows_hold_hashes_never_the_email_or_token(self):
        block = MIGRATION.split("CREATE TABLE property_objection", 1)[1].split(");", 1)[0]
        self.assertIn("contact_email_hash text NOT NULL", block)
        self.assertIn("token_hash text NOT NULL UNIQUE", block)
        self.assertIn("request_ip_hash", block)
        for forbidden in ("email text", "token text", "name text", "phone"):
            self.assertNotIn(forbidden, block)
        self.assertIn("CHECK (uprn IS NOT NULL OR address_id IS NOT NULL)", block)
        self.assertIn("CHECK (status IN ('pending', 'active', 'revoked'))", block)

    def test_suppression_view_covers_both_keys_and_only_active_rows(self):
        view = MIGRATION.split("CREATE VIEW suppressed_dwelling", 1)[1].split(";", 1)[0]
        self.assertIn("o.status = 'active'", view)
        self.assertIn("uprn", view)
        self.assertIn("address_id", view)

    def test_tile_excludes_suppressed_dwellings_but_keeps_block_aggregates(self):
        tile = MIGRATION.split("CREATE OR REPLACE FUNCTION public.property_tile", 1)[1]
        valued = tile.split("valued AS NOT MATERIALIZED", 1)[1].split("), parcels AS", 1)[0]
        self.assertIn("NOT EXISTS (SELECT 1 FROM suppressed_dwelling", valued)
        blocks = tile.split("block_features AS", 1)[1].split("), tile_parcels", 1)[0]
        self.assertNotIn("suppressed_dwelling", blocks)


if __name__ == "__main__":
    unittest.main()
