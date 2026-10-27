"""Migration journal and runner (deploy/migrate.sh, backlog #19).

The static tests always run. The database test boots the compose database on an empty volume (several
minutes under amd64 emulation) and runs only with CLOSE_KNIT_MIGRATE_DB_TEST=1:
    CLOSE_KNIT_MIGRATE_DB_TEST=1 python3 -m unittest tests.test_migrate     (from deploy/)
"""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import unittest

DEPLOY = Path(__file__).resolve().parents[1]
MIGRATIONS = sorted(p.name for p in (DEPLOY / "migrations").glob("[0-9]*.sql"))


class MigrateWiringTests(unittest.TestCase):
    def test_compose_mounts_the_directory_not_each_file(self):
        compose = (DEPLOY / "docker-compose.yml").read_text()
        self.assertIn("- ./migrations:/close-knit/migrations:ro", compose)
        self.assertIn("- ./migrate.sh:/close-knit/migrate.sh:ro", compose)
        self.assertIn("- ./initdb-migrate.sh:/docker-entrypoint-initdb.d/900-migrate.sh:ro", compose)
        self.assertNotRegex(compose, r"\./migrations/\d")  # no per-file mounts: initdb would run it twice
        self.assertIn("migrate.sh init", (DEPLOY / "initdb-migrate.sh").read_text())

    def test_ship_applies_migrations_before_the_new_api_starts(self):
        ship = (DEPLOY / "ship.sh").read_text()
        self.assertIn("./migrate.sh apply", ship)
        self.assertLess(ship.index("./migrate.sh apply"), ship.index("up -d --build --no-deps api mcp web"))

    def test_preflight_checks_the_journal(self):
        self.assertIn("migrate.sh status", (DEPLOY / "preflight.sh").read_text())

    def test_an_unreachable_database_stops_the_runner(self):
        run = subprocess.run([str(DEPLOY / "migrate.sh"), "apply"], env=dict(os.environ, CLOSE_KNIT_PSQL="false"),
                             capture_output=True, text=True)
        self.assertNotEqual(run.returncode, 0)
        self.assertIn("cannot query the database", run.stderr)

    def test_runner_is_executable_and_names_are_unique_numbers(self):
        for script in ("migrate.sh", "initdb-migrate.sh"):
            self.assertTrue(os.access(DEPLOY / script, os.X_OK), script)
        numbers = [name.split("-", 1)[0] for name in MIGRATIONS]
        self.assertEqual(len(numbers), len(set(numbers)), "two migrations share a number")


@unittest.skipUnless(os.environ.get("CLOSE_KNIT_MIGRATE_DB_TEST") == "1", "set CLOSE_KNIT_MIGRATE_DB_TEST=1 (Docker)")
class MigrateDatabaseTests(unittest.TestCase):
    project = "close-knit-migrate-test"

    @classmethod
    def setUpClass(cls):
        cls.env = dict(os.environ, CLOSE_KNIT_DB_PASSWORD="migrate-test", CLOSE_KNIT_OBJECTION_SALT="migrate-test")
        cls.compose = ["docker", "compose", "--project-name", cls.project, "-f", str(DEPLOY / "docker-compose.yml")]
        cls.env["CLOSE_KNIT_PSQL"] = " ".join(
            cls.compose + ["exec", "-T", "database", "psql", "-U", "close_knit", "-d", "close_knit"])
        subprocess.run(cls.compose + ["down", "--volumes"], env=cls.env, capture_output=True)
        subprocess.run(cls.compose + ["up", "-d", "--wait", "database"], env=cls.env, check=True, capture_output=True)
        cls.tmp = Path(tempfile.mkdtemp())

    @classmethod
    def tearDownClass(cls):
        subprocess.run(cls.compose + ["down", "--volumes"], env=cls.env, capture_output=True)
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def sql(self, query):
        return subprocess.run(self.compose + ["exec", "-T", "database", "psql", "-U", "close_knit", "-d", "close_knit",
                                              "-XAtc", query], env=self.env, check=True, capture_output=True,
                              text=True).stdout.strip()

    def migrate(self, *args, migrations=None):
        env = dict(self.env, CLOSE_KNIT_MIGRATIONS=str(migrations or DEPLOY / "migrations"))
        return subprocess.run([str(DEPLOY / "migrate.sh"), *args], env=env, capture_output=True, text=True)

    def journal(self):
        return self.sql("SELECT how, count(*), max(version) FROM schema_migrations GROUP BY how ORDER BY how")

    def test_journal_lifecycle(self):
        last = int(MIGRATIONS[-1].split("-", 1)[0])
        # A fresh database (initdb) has every migration, England's included, and a journal row for each.
        self.assertEqual(self.journal(), f"applied|{len(MIGRATIONS)}|{last}")
        self.assertEqual(self.sql("SELECT to_regclass('area_region') IS NOT NULL"
                                  " AND to_regprocedure('area_tile_mvt(text,integer,integer,integer)') IS NOT NULL"), "t")
        # Second run: nothing to do.
        stamp = self.sql("SELECT max(applied_at) FROM schema_migrations")
        run = self.migrate("apply")
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn("up to date", run.stdout)
        self.assertEqual(self.sql("SELECT max(applied_at) FROM schema_migrations"), stamp)
        self.assertEqual(self.migrate("status").returncode, 0)
        # The smoke test's seed still loads on the full schema.
        subprocess.run(self.compose + ["exec", "-T", "database", "psql", "-U", "close_knit", "-d", "close_knit",
                                       "-v", "ON_ERROR_STOP=1", "-q"], env=self.env, check=True, capture_output=True,
                       input=(DEPLOY / "tests" / "seed-area.sql").read_bytes())

        # Prod-like: migrations applied by hand, no journal. apply refuses and runs nothing.
        self.sql("DROP TABLE schema_migrations")
        run = self.migrate("apply")
        self.assertNotEqual(run.returncode, 0)
        self.assertIn("baseline", run.stderr)
        self.assertEqual(self.sql("SELECT to_regclass('schema_migrations')"), "")
        self.assertNotEqual(self.migrate("status").returncode, 0)
        # One-off baseline, then apply is a no-op.
        self.assertEqual(self.migrate("baseline", str(last)).returncode, 0)
        self.assertEqual(self.journal(), f"baseline|{len(MIGRATIONS)}|{last}")
        run = self.migrate("apply")
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn("up to date", run.stdout)

        # A migration added later (another branch's 119+) is applied once.
        extra = self.tmp / "migrations"
        shutil.copytree(DEPLOY / "migrations", extra)
        (extra / "999-journal-test.sql").write_text("CREATE TABLE journal_test (id int);\n-- no newline at the end")
        self.assertEqual(self.migrate("status", migrations=extra).stdout.strip().splitlines()[0],
                         "pending  999-journal-test.sql")
        run = self.migrate("apply", migrations=extra)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn("applied 999-journal-test.sql", run.stdout)
        self.assertIn("up to date", self.migrate("apply", migrations=extra).stdout)
        self.assertEqual(self.sql("SELECT how FROM schema_migrations WHERE name = '999-journal-test.sql'"), "applied")

        # An applied file that was edited stops apply until it is reverted or redone.
        (extra / "999-journal-test.sql").write_text("CREATE TABLE IF NOT EXISTS journal_test (id int);\n")
        run = self.migrate("apply", migrations=extra)
        self.assertNotEqual(run.returncode, 0)
        self.assertIn("999-journal-test.sql", run.stderr)
        self.assertEqual(self.migrate("redo", "999-journal-test.sql", migrations=extra).returncode, 0)
        self.assertIn("up to date", self.migrate("apply", migrations=extra).stdout)

        # A failing migration leaves neither its changes nor a journal row.
        (extra / "998-broken.sql").write_text("CREATE TABLE broken_test (id int);\nSELECT 1 / 0;\n")
        run = self.migrate("apply", migrations=extra)
        self.assertNotEqual(run.returncode, 0)
        self.assertEqual(self.sql("SELECT to_regclass('broken_test')"), "")
        self.assertEqual(self.sql("SELECT count(*) FROM schema_migrations WHERE name = '998-broken.sql'"), "0")


if __name__ == "__main__":
    unittest.main()
