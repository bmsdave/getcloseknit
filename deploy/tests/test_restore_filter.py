"""A snapshot restore must never drop the production-only tables once they exist."""
import subprocess
import unittest
from pathlib import Path

RESTORE = Path(__file__).resolve().parents[1] / "tools" / "db-restore.sh"

# Excerpt of a real `pg_restore -l` listing of a db-snapshot.sh dump.
LISTING = """\
3079; 3079 28826 EXTENSION - postgis
0; 0 0 COMMENT - EXTENSION postgis
3001; 1259 283579 TABLE public correction_report close_knit
3002; 1259 283578 SEQUENCE public correction_report_id_seq close_knit
3003; 1259 30304 TABLE public profile_analytics_event postgres
3004; 1259 30303 SEQUENCE public profile_analytics_event_id_seq postgres
3005; 1259 283540 TABLE public property_objection close_knit
3006; 1259 283539 SEQUENCE public property_objection_id_seq close_knit
3007; 1259 283573 VIEW public suppressed_dwelling close_knit
3008; 1259 28900 TABLE public property close_knit
3009; 1259 28901 TABLE public address close_knit
3010; 0 28900 TABLE DATA public property close_knit
3011; 2606 283556 CONSTRAINT public property_objection property_objection_pkey close_knit
3012; 1259 283571 INDEX public property_objection_email_idx close_knit
3013; 2606 283564 FK CONSTRAINT public property_objection property_objection_address_id_fkey close_knit
3014; 2606 283593 FK CONSTRAINT public correction_report correction_report_product_release_id_fkey close_knit
3015; 2606 283600 CONSTRAINT public property property_pkey close_knit
"""

KEPT = ("property_objection", "correction_report", "profile_analytics_event", "access_invite", "mcp_feedback", "product_event",
        "agency_opt_out", "site_feedback")


def run_filter(*tables: str) -> list[str]:
    result = subprocess.run(
        ["bash", str(RESTORE), "--filter-list", *tables],
        input=LISTING, capture_output=True, text=True, check=True,
    )
    return result.stdout.splitlines()


class RestoreFilterTests(unittest.TestCase):
    def test_existing_production_tables_are_left_out_entirely(self):
        kept = run_filter(*KEPT)
        for line in kept:
            for table in KEPT:
                self.assertNotIn(f" public {table} ", line)
                self.assertNotIn(f" public {table}_", line)

    def test_release_tables_and_the_suppression_view_are_still_restored(self):
        kept = "\n".join(run_filter(*KEPT))
        for entry in ("TABLE public property ", "TABLE public address ",
                      "TABLE DATA public property ", "CONSTRAINT public property property_pkey",
                      "VIEW public suppressed_dwelling"):
            self.assertIn(entry, kept)

    def test_extensions_are_always_dropped(self):
        for lines in (run_filter(), run_filter(*KEPT)):
            self.assertFalse(any("EXTENSION" in line for line in lines))

    def test_a_first_restore_creates_the_production_tables(self):
        fresh = "\n".join(run_filter())
        self.assertIn("TABLE public property_objection ", fresh)
        self.assertIn("TABLE public correction_report ", fresh)

    def test_the_daily_backup_covers_every_production_only_table(self):
        backup = (RESTORE.parent / "backup-prod-data.sh").read_text()
        for table in KEPT:
            self.assertIn(f"--table={table} ", backup.replace("\\\n", " ") + " ")

    def test_restore_checks_objections_survive(self):
        script = RESTORE.read_text()
        self.assertIn("property_objection rows changed", script)
        self.assertIn("contype = 'f'", script)


if __name__ == "__main__":
    unittest.main()
