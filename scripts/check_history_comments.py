#!/usr/bin/env python3
"""Fail on comments that narrate history instead of explaining the code as it is.

A comment says why the code is the way it is now. Ticket numbers ("Fix 12", "v4 Task 31") and date stamps
("2026-10-18") belong in commit messages and docs, so new ones in api/area_api and web/src are rejected.
A date inside a file name (docs/specs/2026-10-18-x.md) is a reference, not a stamp, and passes.
Only comments and Python docstrings are read; strings and code are left alone.

    scripts/check_history_comments.py            # check api/area_api and web/src
    scripts/check_history_comments.py FILE...    # check these files
"""
from __future__ import annotations

import io
import pathlib
import re
import sys
import tokenize

ROOT = pathlib.Path(__file__).resolve().parent.parent
TREES = ("api/area_api", "web/src")
SUFFIXES = {".py", ".ts", ".tsx", ".js", ".mjs", ".css"}

HISTORY = re.compile(
    r"\b(?:Fix|Task)s? \d+"  # ticket numbers: Fix 12, v4 Task 31, Tasks 21, 8
    r"|(?<![\w./\"'-])v[4-9]\.\d(?![\w.])"  # a product round: v4.2 (OGL v3.0 and schema.v4 pass)
    r"|(?<![\w./\"'-])20\d\d-[01]\d-[0-3]\d(?![\w./\"'-])"  # a date stamp; not in a file name or a quoted example
)


def js_comments(text: str) -> list[tuple[int, int]]:
    """(start, end) of every // and /* */ comment in TS, JS or CSS, skipping string and template literals."""
    spans: list[tuple[int, int]] = []
    i, n = 0, len(text)
    braces: list[int] = []  # one open-brace count per ${ … } we are inside, innermost last
    while i < n:
        c = text[i]
        if c == "`" or (c == "}" and braces and braces[-1] == 0):
            # Template text runs to its closing backtick or to the next ${, whose code is scanned as code.
            if c == "}":
                braces.pop()
            i += 1
            while i < n and text[i] != "`" and not text.startswith("${", i):
                i += 2 if text[i] == "\\" else 1
            if text.startswith("${", i):
                braces.append(0)
                i += 2
            else:
                i += 1
        elif c in "{}" and braces:
            braces[-1] += 1 if c == "{" else -1
            i += 1
        elif text.startswith("//", i):
            end = text.find("\n", i)
            end = n if end < 0 else end
            spans.append((i, end))
            i = end
        elif text.startswith("/*", i):
            end = text.find("*/", i + 2)
            end = n if end < 0 else end + 2
            spans.append((i, end))
            i = end
        elif c in "'\"":
            # An apostrophe in JSX text opens a "string" too: ending it at the line keeps that local.
            i += 1
            while i < n and text[i] != c and text[i] != "\n":
                i += 2 if text[i] == "\\" else 1
            i += 1
        else:
            i += 1
    return spans


def py_comments(text: str) -> list[tuple[int, int]]:
    """(start, end) of every # comment and docstring in Python source."""
    starts = [0]
    for line in io.StringIO(text):
        starts.append(starts[-1] + len(line))
    spans: list[tuple[int, int]] = []
    prev = tokenize.NEWLINE
    for tok in tokenize.generate_tokens(io.StringIO(text).readline):
        doc = tok.type == tokenize.STRING and prev in (tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT, tokenize.NL)
        if tok.type == tokenize.COMMENT or doc:
            spans.append((starts[tok.start[0] - 1] + tok.start[1], starts[tok.end[0] - 1] + tok.end[1]))
        if tok.type not in (tokenize.COMMENT, tokenize.NL):
            prev = tok.type
        elif tok.type == tokenize.NL and prev in (tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT):
            prev = tokenize.NL
    return spans


def comment_spans(path: pathlib.Path, text: str) -> list[tuple[int, int]]:
    return py_comments(text) if path.suffix == ".py" else js_comments(text)


def problems(path: pathlib.Path, text: str) -> list[str]:
    found = []
    for start, end in comment_spans(path, text):
        for m in HISTORY.finditer(text, start, end):
            line = text.count("\n", 0, m.start()) + 1
            found.append(f"{path}:{line}: history in a comment: {m.group(0)!r}")
    return found


def files(args: list[str]) -> list[pathlib.Path]:
    if args:
        return [pathlib.Path(a) for a in args]
    return sorted(p for tree in TREES for p in (ROOT / tree).rglob("*")
                  if p.suffix in SUFFIXES and "node_modules" not in p.parts)


def main(args: list[str]) -> int:
    found = [msg for p in files(args) for msg in problems(p, p.read_text(encoding="utf-8"))]
    for msg in found:
        print(msg)
    if found:
        print(f"{len(found)} history comment(s): say why the code is as it is; tickets and dates go in the commit.")
        return 1
    print("history comments ok")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
