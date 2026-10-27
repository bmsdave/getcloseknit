"""Weekly check that the portals' unofficial search formats still hold (D1).

    python -m area_api.portal_link_check            # print the results; exit 1 if one failed
    python -m area_api.portal_link_check --record   # also store them (portal_link_check, migration 072)

Rightmove answers plain HTTP: its drawn-area page must say "Drawn Area" in the title with a number of
results, and a borough search must name the borough. Zoopla answers scripts with a Cloudflare 403, so
its draw link is only built and decoded here (D1). A failed check stored with --record sends that
portal and kind to the postcode-district fallback (portal_zones.format_on) until a later check passes;
the exit code is the alert (cron mails it; deploy/README.md).
"""
from __future__ import annotations

import argparse
import re
import sys
import urllib.request
from dataclasses import dataclass
from typing import Callable

from . import portal_zones

# D1's box around Clapham Common, budget £800k, 2+ bedrooms.
CLAPHAM = [(51.4640, -0.1560), (51.4640, -0.1400), (51.4560, -0.1400), (51.4560, -0.1560)]
CLAPHAM_POLYLINE = "_qbyH~m]?_cB~p@??~bB_q@?"
LAMBETH = "E09000022"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36"
TITLE = re.compile(r"<title[^>]*>([^<]*)</title>")
RESULT_COUNT = re.compile(r'"resultCount":"?([0-9,]+)')


@dataclass
class Check:
    portal: str
    kind: str
    ok: bool
    detail: str


def fetch(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Language": "en-GB"})
    with urllib.request.urlopen(request, timeout=30) as answer:  # noqa: S310 - fixed https portal URLs
        return answer.read().decode("utf-8", "replace")


def _page_check(portal: str, kind: str, url: str, expect: str, get: Callable[[str], str]) -> Check:
    try:
        page = get(url)
    except Exception as error:  # noqa: BLE001 - a block, a timeout or a 4xx/5xx is a failed check
        return Check(portal, kind, False, f"fetch failed: {error}"[:200])
    title = TITLE.search(page)
    count = RESULT_COUNT.search(page)
    title_text = title.group(1).strip() if title else ""
    if expect not in title_text or count is None:
        return Check(portal, kind, False, f"unexpected page: title {title_text!r}, resultCount {'found' if count else 'missing'}"[:200])
    return Check(portal, kind, True, f"{title_text} · {count.group(1)} results"[:200])


def run(get: Callable[[str], str] = fetch) -> list[Check]:
    polyline = portal_zones.encode_polyline(CLAPHAM)
    checks = []
    if polyline != CLAPHAM_POLYLINE:
        checks.append(Check("rightmove", "draw", False, f"polyline encoder drifted: {polyline}"))
    else:
        checks.append(_page_check("rightmove", "draw", portal_zones.draw_url("rightmove", "buy", polyline, 800_000, 2),
                                  "Drawn Area", get))
    checks.append(_page_check("rightmove", "borough", portal_zones.borough_url("rightmove", "buy", LAMBETH, 800_000, 2),
                              "Lambeth", get))
    zoopla = portal_zones.draw_url("zoopla", "buy", polyline, 800_000, 2) or ""
    built = "polyenc=" in zoopla and portal_zones.decode_polyline(polyline)[:4] == CLAPHAM
    checks.append(Check("zoopla", "draw", built, "built only: Zoopla answers scripts with 403 (D1)" if built else "did not build"))
    return checks


def record(checks: list[Check], connect: Callable | None = None) -> None:
    from .repository import evidence_connection

    with (connect or evidence_connection)() as connection:
        for check in checks:
            connection.execute("INSERT INTO portal_link_check (portal, kind, ok, detail) VALUES (%s, %s, %s, %s)",
                               (check.portal, check.kind, check.ok, check.detail))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--record", action="store_true", help="store the results for the API's fallback")
    args = parser.parse_args(argv)
    checks = run()
    for check in checks:
        print(f"{'ok  ' if check.ok else 'FAIL'} {check.portal:<10} {check.kind:<8} {check.detail}")
    if args.record:
        record(checks)
    return 0 if all(check.ok for check in checks) else 1


if __name__ == "__main__":
    sys.exit(main())
