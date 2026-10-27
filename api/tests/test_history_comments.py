"""scripts/check_history_comments.py: ticket numbers and date stamps in comments fail; code and strings pass."""
import importlib.util
import pathlib
import unittest

_PATH = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "check_history_comments.py"
_spec = importlib.util.spec_from_file_location("check_history_comments", _PATH)
check = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check)

TS = pathlib.Path("x.tsx")
PY = pathlib.Path("x.py")
CSS = pathlib.Path("x.css")


def found(path, text):
    return [msg.split("comment: ")[1] for msg in check.problems(path, text)]


class HistoryCommentTests(unittest.TestCase):
    def test_ticket_numbers_in_ts_comments_fail(self):
        self.assertEqual(found(TS, "const a = 1; // the pill (v4 Task 31)\n"), ["'Task 31'"])
        self.assertEqual(found(TS, "/**\n * Fix 12: why\n */\n"), ["'Fix 12'"])
        self.assertEqual(found(TS, "<div>{/* v4.6: the row */}</div>\n"), ["'v4.6'"])

    def test_date_stamps_in_css_and_python_fail(self):
        self.assertEqual(found(CSS, "/* measured (2026-10-25) */\na { b: c; }\n"), ["'2026-10-25'"])
        self.assertEqual(found(PY, "x = 1  # owner decision 2026-10-17\n"), ["'2026-10-17'"])
        self.assertEqual(found(PY, 'def f():\n    """Tasks 21, 8: the model."""\n'), ["'Tasks 21'"])

    def test_strings_and_code_pass(self):
        self.assertEqual(found(TS, 'const s = "Fix 12 // Task 3";\nconst d = "2026-10-25";\n'), [])
        self.assertEqual(found(TS, "const t = `${a ? `x ${b}'s` : \"\"} Task 4`; // fine\n"), [])
        self.assertEqual(found(PY, 'SQL = """-- Task 9\nselect 1"""\nLICENCE = "OGL v3.0"\n'), [])

    def test_references_and_examples_pass(self):
        self.assertEqual(found(PY, "# docs/specs/2026-10-18-extension-gaps.md, OGL v3.0, area-x.v4.2\n"), [])
        self.assertEqual(found(TS, '/** "2026-10-05" -> "5 October 2026". */\n'), [])

    def test_line_numbers(self):
        msgs = check.problems(TS, "a;\nb;\n// Fix 3\n")
        self.assertEqual(len(msgs), 1)
        self.assertIn("x.tsx:3:", msgs[0])


if __name__ == "__main__":
    unittest.main()
