from pathlib import Path
import unittest


SCHEMA = (Path(__file__).parents[1] / "schema.sql").read_text()


class AtomicReleaseSchemaTests(unittest.TestCase):
    def test_product_release_manifest_table_exists(self):
        block = _table_block("product_release")
        for fragment in (
            "geography_vintage",
            "transformation_versions",
            "assets",
            "validation_status",
            "validation_record",
        ):
            self.assertIn(fragment, block)

    def test_release_members_name_permitted_source_versions(self):
        block = _table_block("product_release_member")
        self.assertIn("release_id", block)
        self.assertIn("REFERENCES product_release(id)", block)
        self.assertIn("REFERENCES source_release(id)", block)

    def test_single_active_pointer_retains_last_known_good(self):
        block = _table_block("active_product_release")
        self.assertIn("singleton", block)
        self.assertIn("release_id", block)
        self.assertIn("previous_release_id", block)
        self.assertIn("REFERENCES product_release(id)", block)

    def test_activation_is_validated_and_audited(self):
        self.assertIn("activate_product_release", SCHEMA)
        self.assertIn("CREATE TABLE product_release_activation", SCHEMA)
        activation = SCHEMA.split("activate_product_release", 1)[1]
        self.assertIn("validation", activation)
        self.assertIn("product_release_activation", activation)
        self.assertIn("active_product_release", activation)

    def test_rollback_uses_previous_pointer_without_touching_sources(self):
        self.assertIn("rollback_product_release", SCHEMA)
        rollback = SCHEMA.split("rollback_product_release", 1)[1].split("$$;", 1)[0]
        self.assertIn("previous_release_id", rollback)
        self.assertNotIn("source_release", rollback)

    def test_activation_argument_is_distinct_from_member_columns(self):
        head, body = SCHEMA.split(
            "CREATE FUNCTION activate_product_release(", 1)[1].split("$$;", 1)
        argument = head.split(")", 1)[0].strip().split()[0]
        self.assertNotEqual(argument, "release_id")
        for line in body.splitlines():
            code = line.split("--", 1)[0]
            if ("= release_id" in code
                    and "member.release_id" not in code
                    and "active.release_id" not in code
                    and "activate_product_release.release_id" not in code):
                self.fail(f"ambiguous bare release_id reference: {line.strip()}")

    def test_release_tables_are_immutable(self):
        for fragment in (
            "product_release_immutable",
            "product_release_member_immutable",
            "Product releases are immutable",
        ):
            self.assertIn(fragment, SCHEMA)


def _table_block(table: str) -> str:
    block = SCHEMA.split(f"CREATE TABLE {table}", 1)[1]
    return block.split(");", 1)[0]


if __name__ == "__main__":
    unittest.main()
