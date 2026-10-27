"""School name as a council prints it -> URN of the current school in table `school`, within one LA.

Matching is exact on a normalised name (case, punctuation, possessive 's, 'St'/'Saint', 'C of E'/
'CE'/'Church of England', 'RC'/'Catholic', and the words 'school', 'primary', 'academy', 'nursery'
are ignored; 'infant', 'junior', 'high' and the denomination are kept). A name that normalises to two schools is ambiguous and stays
unmatched unless the phase settles it. Anything unmatched goes to the review file, never to a
guess: add an alias (printed name -> URN) to boroughs/<slug>.yaml instead.
"""
from __future__ import annotations

import re
from collections import defaultdict
from collections.abc import Iterable

from .parsers import clean

_REPLACE = (
    (r"'s\b", ""),
    (r"'", ""),
    (r"\bjunior (?:and|&) infants?\b|\binfants? (?:and|&) junior\b|\bj ?& ?i\b|\bjmi\b", "primary"),
    (r"&", " and "),
    (r"\bsaint\b|\bst\.", "st"),
    (r"\bchurch of england\b|\bc of e\b|\bc\.?e\.?\b|\bcofe\b", "ce"),
    (r"\broman catholic\b|\br\.?c\.?\b", "catholic"),
    (r"\bvoluntary aided\b|\(va\)|\bva\b", " "),
)
_DROP = {"the", "school", "schools", "primary", "academy", "academies", "and", "of", "london", "borough",
         "nursery", "arp"}


def normalise(name: str) -> str:
    text = clean(name).lower()
    text = re.sub(r"\([^)]*(?:formerly|was|previously)[^)]*\)", " ", text)  # '(formerly X)'
    for pattern, replacement in _REPLACE:
        text = re.sub(pattern, replacement, text)
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    return " ".join(word for word in text.split() if word not in _DROP)


class SchoolMatcher:
    """schools: (urn, name, phase) of the LA's current schools; extra_names: (name, current urn)
    such as GIAS names of predecessors; aliases: printed name -> current urn (from config)."""

    def __init__(self, schools: Iterable[tuple[str, str, str]], aliases: dict | None = None,
                 extra_names: Iterable[tuple[str, str]] = ()):
        self.phase: dict[str, str] = {}
        self.name: dict[str, str] = {}
        self.keys: dict[str, set[str]] = defaultdict(set)
        for urn, name, phase in schools:
            self.phase[urn], self.name[urn] = phase, name
            self.keys[normalise(name)].add(urn)
        for name, urn in extra_names:
            if urn in self.name:
                self.keys[normalise(name)].add(urn)
        self.aliases = {normalise(k): str(v) for k, v in (aliases or {}).items()}
        unknown = sorted(set(self.aliases.values()) - set(self.name))
        if unknown:
            raise ValueError(f"aliases point at URNs not among this LA's schools: {', '.join(unknown)}")

    def match(self, printed: str, phase: str | None = None) -> str | None:
        key = normalise(printed)
        if key in self.aliases:
            return self.aliases[key]
        urns = self.keys.get(key, set())
        if len(urns) > 1 and phase:
            urns = {urn for urn in urns if self.phase[urn] == phase}
        return next(iter(urns)) if len(urns) == 1 else None

    @classmethod
    def from_db(cls, cur, la_name: str, aliases: dict | None = None,
                extra_names: Iterable[tuple[str, str]] = ()) -> SchoolMatcher:
        """The LA's schools from table `school` (attributes.localAuthority = la_name)."""
        rows = cur.execute("SELECT urn, name, phase FROM school WHERE attributes->>'localAuthority' = %s",
                           (la_name,)).fetchall()
        rows = [(r["urn"], r["name"], r["phase"]) if isinstance(r, dict) else tuple(r) for r in rows]
        return cls(rows, aliases, extra_names)
