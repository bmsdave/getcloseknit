"""/agents (Claude tab) offers the find-a-home skill as /downloads/find-a-home.zip: it must match the plugin's skill."""
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / "agents" / "claude" / "plugin" / "skills"
ZIP = ROOT / "web" / "public" / "downloads" / "find-a-home.zip"


class SkillDownloadTests(unittest.TestCase):
    def test_zip_matches_the_plugin_skill(self):
        source = {str(path.relative_to(SKILL)): path.read_bytes()
                  for path in (SKILL / "find-a-home").rglob("*") if path.is_file() and path.name != ".DS_Store"}
        with zipfile.ZipFile(ZIP) as archive:
            packed = {name: archive.read(name) for name in archive.namelist() if not name.endswith("/")}
        self.assertEqual(packed, source, "rebuild: agents/claude/build-skill-zip.sh web/public/downloads/find-a-home.zip")


if __name__ == "__main__":
    unittest.main()
