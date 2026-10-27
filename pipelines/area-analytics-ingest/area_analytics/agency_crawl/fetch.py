"""Polite page fetcher for estate agents' own websites.

Plain HTTP, no JavaScript, no logins, no cookies kept. robots.txt (with Crawl-delay) is honoured,
at most one request per MIN_INTERVAL to a domain, and the first 403/429 or challenge page stops
the domain for the run: it is reported as blocked and never worked around. Shared hosts (portals, social
networks: urls.SHARED_HOSTS) and hosts on private, loopback, link-local or reserved addresses are never
requested, on any redirect hop: the outcome is error.
"""

import ipaddress
import socket
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from http.client import HTTPException
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser

from .urls import is_shared_host, site_domain

USER_AGENT = "CloseKnitBot/1.0 (+https://getcloseknit.com/bot)"
MIN_INTERVAL = 5.0
MAX_BYTES = 2_000_000
TIMEOUT = 20
MAX_REDIRECTS = 5
MAX_CRAWL_DELAY = 60  # a longer Crawl-delay closes the domain for this run rather than stalling it
ROBOTS_MAX_BYTES = 500_000
ERROR_BODY_BYTES = 200_000  # an error page is only read to look for a challenge marker

WAF_STATUSES = (403, 429)
ROBOTS_WAF_STATUSES = (401, 403, 429)
# Markers of a challenge page on any status. "challenge-platform" alone also appears in Cloudflare's
# JS-detections script on ordinary pages, so it counts only on the statuses a challenge is served with.
CHALLENGE_MARKERS = ("cf-chl", "<title>just a moment", "attention required! | cloudflare")
CHALLENGE_STATUS_MARKERS = ("challenge-platform",)
CHALLENGE_STATUSES = (403, 429, 503)


@dataclass(frozen=True)
class Page:
    """outcome: ok | blocked | robots | dead | skipped | error. text is set only when ok."""

    url: str
    final_url: str
    domain: str
    status: int
    text: str | None
    outcome: str


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Hand 3xx answers back, so every hop gets its own robots, block and pacing checks."""

    def redirect_request(self, *args, **kwargs):
        return None


def default_opener():
    """urllib opener for http and https only: no cookie processor, no automatic redirects, no file/ftp/data."""
    opener = urllib.request.OpenerDirector()
    for handler in (urllib.request.ProxyHandler(), urllib.request.HTTPHandler(), urllib.request.HTTPSHandler(),
                    _NoRedirect(), urllib.request.HTTPDefaultErrorHandler(), urllib.request.HTTPErrorProcessor()):
        opener.add_handler(handler)
    return opener


@dataclass
class _Response:
    status: int
    headers: object
    body: bytes
    truncated: bool


class _Dead(Exception):
    """DNS failure, refused connection, reset or timeout."""


class _BadUrl(Exception):
    """An address the HTTP stack cannot send (over-long host label, bad characters) or not http(s)."""


class _Refused(Exception):
    """A shared host, or a host on a private, loopback, link-local or reserved address: never requested."""


def _not_public(address):
    ip = ipaddress.ip_address(address.split("%", 1)[0])  # an IPv6 address may carry a %zone
    ip = getattr(ip, "ipv4_mapped", None) or ip
    return (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast
            or ip.is_unspecified)


class Fetcher:
    def __init__(self, opener=None, clock=time.monotonic, sleep=time.sleep, allow_private=False,
                 resolve=socket.getaddrinfo):
        """allow_private lets tests reach servers on 127.0.0.1; resolve is socket.getaddrinfo or a test double."""
        self._opener = opener or default_opener()
        self._clock = clock
        self._sleep = sleep
        self._allow_private = allow_private
        self._resolve = resolve
        self._hosts = {}  # host -> None when it may be requested, else the exception class that stops it
        self._last = {}  # domain -> clock() when its last request finished
        self._robots = {}  # domain -> (RobotFileParser | None, crawl delay) or "blocked" / "closed"
        self.blocked = set()  # domains stopped for this run
        self._guard = threading.Lock()
        self._locks = {}  # domain -> Lock, held for a whole hop so a domain is never hit by two threads at once

    def _domain_lock(self, domain):
        with self._guard:
            return self._locks.setdefault(domain, threading.Lock())

    def get(self, url):
        current = url
        for _ in range(MAX_REDIRECTS + 1):
            page, location = self._hop(url, current)
            if location is None:
                return page
            current = urljoin(current, location)
        return Page(url, current, site_domain(current) or "", 0, None, "error")

    def _hop(self, url, current):
        """One request. Returns (Page, None) when finished or (None, Location) for a redirect."""
        domain = site_domain(current)
        if domain is None:
            return Page(url, current, "", 0, None, "error"), None

        def done(status, text, outcome):
            return Page(url, current, domain, status, text, outcome), None

        with self._domain_lock(domain):  # block check, robots, pacing and the request are one step per domain
            if domain in self.blocked:
                return done(0, None, "blocked")
            verdict = self._robots_verdict(domain, current)
            if verdict is not None:
                return done(0, None, verdict)
            try:
                response = self._request(domain, current, MAX_BYTES)
            except _Dead:
                return done(0, None, "dead")
            except (_BadUrl, _Refused, HTTPException):
                return done(0, None, "error")

            status = response.status
            if status in WAF_STATUSES or self._is_challenge(response):
                self.blocked.add(domain)
                return done(status, None, "blocked")
            if 300 <= status < 400:
                location = response.headers.get("Location")
                return (None, location) if location else done(status, None, "error")
            if status != 200:
                return done(status, None, "error")
            if response.headers.get_content_type() != "text/html" or response.truncated:
                return done(status, None, "skipped")
            return done(status, self._decode(response), "ok")

    # robots.txt

    def _robots_verdict(self, domain, url):
        """None to go ahead, else the outcome that stops this request."""
        if domain not in self._robots:
            entry = self._load_robots(domain, url)
            if entry is None:  # unreachable: allowed now, asked again next time (www. shares this domain key)
                return None
            self._robots[domain] = entry
        entry = self._robots[domain]
        if entry == "blocked":
            self.blocked.add(domain)
            return "blocked"
        if entry == "closed":
            return "robots"
        parser, _ = entry
        return None if parser is None or parser.can_fetch(USER_AGENT, url) else "robots"

    def _load_robots(self, domain, url):
        parts = urlsplit(url)
        robots_url = f"{parts.scheme}://{parts.netloc}/robots.txt"
        try:
            for _ in range(MAX_REDIRECTS + 1):
                response = self._request(domain, robots_url, ROBOTS_MAX_BYTES)
                if 300 <= response.status < 400 and response.headers.get("Location"):
                    robots_url = urljoin(robots_url, response.headers["Location"])
                    continue
                break
        except (_Dead, _BadUrl, _Refused, HTTPException):
            return None  # unreachable robots.txt: allowed, not cached; the page request reports what is wrong
        if response.status in ROBOTS_WAF_STATUSES:
            return "blocked"  # a firewall answering for robots.txt: stop, do not read on
        if response.status >= 500:
            return "closed"  # RFC 9309: an erroring robots.txt means do not crawl for now
        if response.status != 200:
            return (None, 0)  # 404 and the like: no rules
        parser = RobotFileParser()
        parser.parse(response.body.decode("utf-8", errors="replace").splitlines())
        delay = parser.crawl_delay(USER_AGENT) or 0
        return "closed" if delay > MAX_CRAWL_DELAY else (parser, delay)

    # requests

    def _interval(self, domain):
        entry = self._robots.get(domain)
        delay = entry[1] if isinstance(entry, tuple) else 0
        return max(MIN_INTERVAL, delay)

    def _check_host(self, url):
        """Raise _Refused for a shared or non-public host, _Dead when its name does not resolve; once per host."""
        host = urlsplit(url).hostname
        if host not in self._hosts:
            self._hosts[host] = self._host_verdict(host)
        if self._hosts[host] is not None:
            raise self._hosts[host](host)

    def _host_verdict(self, host):
        if is_shared_host(host):
            return _Refused
        if self._allow_private:
            return None
        try:  # a literal address is judged as it is, without a lookup
            return _Refused if _not_public(host) else None
        except ValueError:
            pass
        try:
            addresses = {info[4][0] for info in self._resolve(host, None, proto=socket.IPPROTO_TCP)}
        except OSError:  # socket.gaierror: the name does not resolve
            return _Dead
        except (UnicodeError, ValueError):  # over-long label and the like: cannot be sent
            return _BadUrl
        return _Refused if not addresses or any(_not_public(a) for a in addresses) else None

    def _request(self, domain, url, limit):
        """GET with pacing. Never raises for HTTP statuses; raises _Dead when the host cannot be reached.

        A request that never reached the host (name not resolved, connection refused) sets no pacing timestamp,
        so a dead guessed domain fails at once instead of waiting MIN_INTERVAL for its page request."""
        if site_domain(url) is None:  # only http(s) is ever opened, whatever a redirect points at
            raise _BadUrl(url)
        self._check_host(url)
        last = self._last.get(domain)
        if last is not None:
            wait = self._interval(domain) - (self._clock() - last)
            if wait > 0:
                self._sleep(wait)
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,*/*;q=0.5"})
        reached = True
        try:
            try:
                response = self._opener.open(request, timeout=TIMEOUT)
            except urllib.error.HTTPError as error:
                response = error  # carries status, headers and body like a response
            with response:
                return self._read(response, limit)
        except (urllib.error.URLError, OSError) as error:  # URLError, refused, reset, timeout
            reached = not isinstance(getattr(error, "reason", error), (socket.gaierror, ConnectionRefusedError))
            raise _Dead(str(error)) from error
        except ValueError as error:  # includes UnicodeError (idna label too long) and InvalidURL
            raise _BadUrl(str(error)) from error
        finally:
            if reached:
                self._last[domain] = self._clock()

    @staticmethod
    def _read(response, limit):
        status = response.status if hasattr(response, "status") else response.code
        declared = response.headers.get("Content-Length")
        if declared and declared.isdigit() and int(declared) > limit:
            return _Response(status, response.headers, b"", True)
        body = response.read(limit + 1)
        return _Response(status, response.headers, body[:limit], len(body) > limit)

    @staticmethod
    def _is_challenge(response):
        head = response.body[:ERROR_BODY_BYTES].decode("utf-8", errors="ignore").lower()
        markers = CHALLENGE_MARKERS + (CHALLENGE_STATUS_MARKERS if response.status in CHALLENGE_STATUSES else ())
        return any(marker in head for marker in markers)

    @staticmethod
    def _decode(response):
        charset = response.headers.get_content_charset() or "utf-8"
        try:
            return response.body.decode(charset, errors="replace")
        except LookupError:
            return response.body.decode("utf-8", errors="replace")
