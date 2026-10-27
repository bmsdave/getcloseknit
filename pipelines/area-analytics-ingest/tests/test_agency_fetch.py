"""Polite fetch client: user agent, robots.txt, pacing, blocks, redirects and size limits (local servers only)."""

import http.client
import io
import socket
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

from area_analytics.agency_crawl import fetch

HTML = "<html><head><title>Foxtons</title></head><body>Lettings and sales in Ealing</body></html>"


def serve(test, routes):
    """A local server on 127.0.0.1. routes: path -> (status, headers, body); unknown paths are 404.

    The handler appends (path, user_agent) to server.log. A body given as bytes is sent as is.
    """
    log = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            log.append((self.path, self.headers.get("User-Agent")))
            status, headers, body = routes.get(self.path, (404, {}, "not found"))
            if callable(body):
                body = body()
            data = body if isinstance(body, bytes) else body.encode()
            self.send_response(status)
            for name, value in headers.items():
                self.send_header(name, value)
            if "Content-Length" not in headers and not headers.get("X-No-Length"):
                self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            try:
                self.wfile.write(data)
            except OSError:
                pass

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    server.log = log
    server.base = f"http://127.0.0.1:{server.server_address[1]}"
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()

    def stop():
        server.shutdown()
        server.server_close()

    test.addCleanup(stop)
    return server


def html(body=HTML, **extra):
    return (200, {"Content-Type": "text/html; charset=utf-8", **extra}, body)


class FakeTime:
    """clock and sleep that never really wait: sleeping just moves the clock on."""

    def __init__(self):
        self.now = 1000.0
        self.sleeps = []

    def clock(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


def PUBLIC(host, *args, **kw):
    """A resolver that puts every name on a public address (example.com's)."""
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 0))]


class FakeOpener:
    """Answers by URL with (status, headers, body); anything else is a 404. Records every URL opened."""

    def __init__(self, routes):
        self.routes, self.opened = routes, []

    def open(self, request, timeout=None):
        self.opened.append(request.full_url)
        status, headers, body = self.routes.get(request.full_url, (404, {}, b""))
        message = http.client.HTTPMessage()
        for name, value in headers.items():
            message[name] = value
        response = io.BytesIO(body)
        response.status, response.headers = status, message
        return response


class FetchTests(unittest.TestCase):
    def fetcher(self):
        self.time = FakeTime()
        return fetch.Fetcher(clock=self.time.clock, sleep=self.time.sleep, allow_private=True)

    def pages(self, server):
        return [path for path, _ in server.log if path != "/robots.txt"]

    def test_constants_are_the_published_values(self):
        self.assertEqual(fetch.USER_AGENT, "CloseKnitBot/1.0 (+https://getcloseknit.com/bot)")
        self.assertEqual((fetch.MIN_INTERVAL, fetch.MAX_BYTES, fetch.TIMEOUT), (5.0, 2_000_000, 20))

    def test_ok_page_carries_text_domain_and_status(self):
        server = serve(self, {"/": html()})
        page = self.fetcher().get(server.base + "/")
        self.assertEqual((page.outcome, page.status, page.domain), ("ok", 200, "127.0.0.1"))
        self.assertEqual((page.url, page.final_url), (server.base + "/", server.base + "/"))
        self.assertIn("Lettings and sales", page.text)

    def test_sends_the_bot_user_agent(self):
        server = serve(self, {"/": html()})
        self.fetcher().get(server.base + "/")
        self.assertEqual({agent for _, agent in server.log}, {fetch.USER_AGENT})
        self.assertIn(("/robots.txt", fetch.USER_AGENT), server.log)

    def test_no_cookies_are_sent_back(self):
        seen = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                seen.append(self.headers.get("Cookie"))
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.send_header("Set-Cookie", "session=abc")
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"ok")

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        server.daemon_threads = True
        threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True).start()
        self.addCleanup(lambda: (server.shutdown(), server.server_close()))
        fetcher = self.fetcher()
        base = f"http://127.0.0.1:{server.server_address[1]}"
        fetcher.get(base + "/a")
        fetcher.get(base + "/b")
        self.assertEqual(seen, [None, None, None])  # robots.txt, /a, /b

    def test_robots_is_fetched_once_per_domain(self):
        server = serve(self, {"/a": html(), "/b": html()})
        fetcher = self.fetcher()
        fetcher.get(server.base + "/a")
        fetcher.get(server.base + "/b")
        self.assertEqual([p for p, _ in server.log].count("/robots.txt"), 1)

    def test_robots_disallow_is_respected(self):
        server = serve(self, {
            "/robots.txt": (200, {"Content-Type": "text/plain"}, "User-agent: *\nDisallow: /private\n"),
            "/private/x": html(), "/public": html()})
        fetcher = self.fetcher()
        page = fetcher.get(server.base + "/private/x")
        self.assertEqual((page.outcome, page.text), ("robots", None))
        self.assertEqual(self.pages(server), [])
        self.assertEqual(fetcher.get(server.base + "/public").outcome, "ok")  # only that path is closed

    def test_a_rule_for_closeknitbot_applies(self):
        server = serve(self, {
            "/robots.txt": (200, {}, "User-agent: *\nAllow: /\n\nUser-agent: CloseKnitBot\nDisallow: /\n"),
            "/": html()})
        self.assertEqual(self.fetcher().get(server.base + "/").outcome, "robots")
        self.assertEqual(self.pages(server), [])

    def test_missing_robots_allows_everything(self):
        server = serve(self, {"/": html()})  # /robots.txt is a 404
        self.assertEqual(self.fetcher().get(server.base + "/").outcome, "ok")

    def test_robots_refused_with_waf_status_blocks_the_domain(self):
        for status in (401, 403, 429):
            with self.subTest(status=status):
                server = serve(self, {"/robots.txt": (status, {}, "denied"), "/": html()})
                fetcher = self.fetcher()
                page = fetcher.get(server.base + "/")
                self.assertEqual(page.outcome, "blocked")
                self.assertIn("127.0.0.1", fetcher.blocked)
                self.assertEqual(self.pages(server), [])

    def test_robots_server_error_is_treated_as_closed(self):
        server = serve(self, {"/robots.txt": (503, {}, "down"), "/": html()})
        self.assertEqual(self.fetcher().get(server.base + "/").outcome, "robots")
        self.assertEqual(self.pages(server), [])

    def test_unreachable_robots_is_allowed_and_the_page_reports_dead(self):
        port = self.closed_port()
        page = self.fetcher().get(f"http://127.0.0.1:{port}/")
        self.assertEqual((page.outcome, page.status, page.text), ("dead", 0, None))

    def test_interval_is_five_seconds_between_requests_to_a_domain(self):
        server = serve(self, {"/a": html(), "/b": html()})
        fetcher = self.fetcher()
        fetcher.get(server.base + "/a")
        fetcher.get(server.base + "/b")
        # robots -> /a -> /b: three requests, two gaps; the very first request does not wait.
        self.assertEqual(self.time.sleeps, [5.0, 5.0])

    def test_time_already_passed_counts_towards_the_interval(self):
        server = serve(self, {"/a": html(), "/b": html()})
        fetcher = self.fetcher()
        fetcher.get(server.base + "/a")
        self.time.now += 100
        self.time.sleeps.clear()
        fetcher.get(server.base + "/b")
        self.assertEqual(self.time.sleeps, [])

    def test_crawl_delay_raises_the_interval(self):
        server = serve(self, {"/robots.txt": (200, {}, "User-agent: *\nCrawl-delay: 9\n"),
                              "/a": html(), "/b": html()})
        fetcher = self.fetcher()
        fetcher.get(server.base + "/a")
        fetcher.get(server.base + "/b")
        self.assertEqual(self.time.sleeps, [9.0, 9.0])

    def test_small_crawl_delay_does_not_lower_the_interval(self):
        server = serve(self, {"/robots.txt": (200, {}, "User-agent: *\nCrawl-delay: 1\n"), "/a": html()})
        self.fetcher().get(server.base + "/a")
        self.assertEqual(self.time.sleeps, [5.0])

    def test_absurd_crawl_delay_closes_the_domain_instead_of_stalling(self):
        server = serve(self, {"/robots.txt": (200, {}, "User-agent: *\nCrawl-delay: 86400\n"), "/a": html()})
        self.assertEqual(self.fetcher().get(server.base + "/a").outcome, "robots")
        self.assertEqual(self.time.sleeps, [])

    def test_403_blocks_the_domain_for_the_run(self):
        server = serve(self, {"/a": (403, {"Content-Type": "text/html"}, "Forbidden"), "/b": html()})
        fetcher = self.fetcher()
        first = fetcher.get(server.base + "/a")
        self.assertEqual((first.outcome, first.status, first.text), ("blocked", 403, None))
        self.assertEqual(fetcher.blocked, {"127.0.0.1"})
        before = len(server.log)
        second = fetcher.get(server.base + "/b")
        self.assertEqual(second.outcome, "blocked")
        self.assertEqual(len(server.log), before)  # no request was made

    def test_429_blocks_the_domain(self):
        server = serve(self, {"/a": (429, {"Retry-After": "60"}, "slow down")})
        fetcher = self.fetcher()
        self.assertEqual(fetcher.get(server.base + "/a").outcome, "blocked")
        self.assertIn("127.0.0.1", fetcher.blocked)

    def test_challenge_pages_block(self):
        for marker in ("id=cf-chl-widget",
                       "<title>Just a moment...</title>", "<title>Attention Required! | Cloudflare</title>"):
            with self.subTest(marker=marker):
                server = serve(self, {"/": html(f"<html>{marker}</html>")})
                fetcher = self.fetcher()
                page = fetcher.get(server.base + "/")
                self.assertEqual((page.outcome, page.text), ("blocked", None))
                self.assertIn("127.0.0.1", fetcher.blocked)

    def test_challenge_served_with_a_503_blocks(self):
        for body in ("<title>Just a moment...</title>", "<script src='/cdn-cgi/challenge-platform/h/b/orchestrate'>"):
            with self.subTest(body=body):
                server = serve(self, {"/": (503, {"Content-Type": "text/html"}, body)})
                self.assertEqual(self.fetcher().get(server.base + "/").outcome, "blocked")

    def test_cloudflare_js_detections_script_on_a_normal_page_is_not_a_block(self):
        body = '<html><body>Homes<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></body></html>'
        server = serve(self, {"/": html(body)})
        fetcher = self.fetcher()
        self.assertEqual(fetcher.get(server.base + "/").outcome, "ok")
        self.assertEqual(fetcher.blocked, set())

    def test_recaptcha_widget_is_not_a_block(self):
        body = ('<html><body><div class="g-recaptcha"></div>'
                '<script src="https://www.google.com/recaptcha/api.js"></script></body></html>')
        server = serve(self, {"/": html(body)})
        fetcher = self.fetcher()
        page = fetcher.get(server.base + "/")
        self.assertEqual(page.outcome, "ok")
        self.assertEqual(fetcher.blocked, set())

    def test_cross_domain_redirect_reports_final_domain(self):
        target = serve(self, {"/landing": html()})
        port = target.server_address[1]
        origin = serve(self, {"/go": (301, {"Location": f"http://localhost:{port}/landing"}, "")})
        page = self.fetcher().get(origin.base + "/go")
        self.assertEqual((page.outcome, page.status, page.domain), ("ok", 200, "localhost"))
        self.assertEqual(page.url, origin.base + "/go")
        self.assertEqual(page.final_url, f"http://localhost:{port}/landing")
        self.assertIn(("/landing", fetch.USER_AGENT), target.log)

    def test_same_site_redirect_is_followed_and_relative_locations_resolve(self):
        server = serve(self, {"/old": (302, {"Location": "/new"}, ""), "/new": html()})
        page = self.fetcher().get(server.base + "/old")
        self.assertEqual((page.outcome, page.final_url), ("ok", server.base + "/new"))

    def test_redirect_target_obeys_its_own_robots_and_block_list(self):
        target = serve(self, {"/robots.txt": (200, {}, "User-agent: *\nDisallow: /\n"), "/landing": html()})
        origin = serve(self, {"/go": (301, {"Location": f"http://localhost:{target.server_address[1]}/landing"}, "")})
        page = self.fetcher().get(origin.base + "/go")
        self.assertEqual((page.outcome, page.domain), ("robots", "localhost"))
        self.assertEqual(self.pages(target), [])

    def test_redirect_loop_is_an_error(self):
        server = serve(self, {"/a": (302, {"Location": "/b"}, ""), "/b": (302, {"Location": "/a"}, "")})
        page = self.fetcher().get(server.base + "/a")
        self.assertEqual((page.outcome, page.text), ("error", None))

    def test_redirect_to_a_non_web_address_is_an_error(self):
        server = serve(self, {"/a": (302, {"Location": "file:///etc/passwd"}, "")})
        self.assertEqual(self.fetcher().get(server.base + "/a").outcome, "error")

    def test_non_html_is_skipped(self):
        server = serve(self, {"/f.pdf": (200, {"Content-Type": "application/pdf"}, b"%PDF-1.4 ...")})
        page = self.fetcher().get(server.base + "/f.pdf")
        self.assertEqual((page.outcome, page.text), ("skipped", None))

    def test_oversized_html_is_skipped(self):
        big = "<html>" + "x" * 3_000_000 + "</html>"
        server = serve(self, {"/big": html(big), "/chunked": html(big, **{"X-No-Length": "1"})})
        fetcher = self.fetcher()
        self.assertEqual(fetcher.get(server.base + "/big").outcome, "skipped")
        self.assertEqual(fetcher.get(server.base + "/chunked").outcome, "skipped")

    def test_html_just_under_the_limit_is_read(self):
        body = "<html>" + "x" * (fetch.MAX_BYTES - 100) + "</html>"
        server = serve(self, {"/": html(body)})
        self.assertEqual(self.fetcher().get(server.base + "/").outcome, "ok")

    def test_other_http_errors_are_error(self):
        server = serve(self, {"/gone": (404, {"Content-Type": "text/html"}, "nothing here"),
                              "/boom": (500, {"Content-Type": "text/html"}, "oops")})
        fetcher = self.fetcher()
        for path, status in (("/gone", 404), ("/boom", 500)):
            page = fetcher.get(server.base + path)
            self.assertEqual((page.outcome, page.status, page.text), ("error", status, None))
        self.assertEqual(fetcher.blocked, set())

    def test_declared_charset_is_used(self):
        server = serve(self, {"/": (200, {"Content-Type": "text/html; charset=iso-8859-1"},
                                    "<html>caf\xe9 estates</html>".encode("latin-1"))})
        self.assertIn("café estates", self.fetcher().get(server.base + "/").text)

    def test_unreachable_host_is_dead(self):
        port = self.closed_port()
        page = self.fetcher().get(f"http://127.0.0.1:{port}/")
        self.assertEqual((page.outcome, page.domain), ("dead", "127.0.0.1"))

    def test_timeout_is_dead(self):
        server = serve(self, {"/slow": (200, {"Content-Type": "text/html"}, lambda: time.sleep(1.5) or HTML)})
        with mock.patch.object(fetch, "TIMEOUT", 0.3):
            page = self.fetcher().get(server.base + "/slow")
        self.assertEqual(page.outcome, "dead")

    def test_unsendable_address_is_an_error_not_an_exception(self):
        page = self.fetcher().get("http://" + "a" * 70 + ".example.com/")
        self.assertEqual((page.outcome, page.text), ("error", None))

    def test_opener_speaks_only_http_and_https(self):
        kinds = {type(handler).__name__ for handler in fetch.default_opener().handlers}
        self.assertTrue({"HTTPHandler", "HTTPSHandler"} <= kinds)
        self.assertFalse(kinds & {"FileHandler", "FTPHandler", "DataHandler", "HTTPCookieProcessor"}, kinds)

    def test_robots_redirect_to_a_file_url_is_not_opened(self):
        server = serve(self, {"/robots.txt": (302, {"Location": "file:///etc/hosts"}, ""), "/": html()})
        fetcher = self.fetcher()
        opened = []
        real = fetcher._opener.open
        fetcher._opener.open = lambda request, **kw: (opened.append(request.full_url), real(request, **kw))[1]
        self.assertEqual(fetcher.get(server.base + "/").outcome, "ok")  # unusable robots.txt: no rules
        self.assertEqual([url for url in opened if not url.startswith("http://127.0.0.1")], [])

    def test_two_threads_on_one_domain_are_paced_and_robots_is_read_once(self):
        server = serve(self, {"/a": html(), "/b": html(),
                              "/robots.txt": (200, {}, lambda: time.sleep(0.05) or "User-agent: *\nAllow: /\n")})
        fetcher = self.fetcher()
        stamps = []
        real = fetcher._opener.open
        fetcher._opener.open = lambda request, **kw: (stamps.append((request.full_url, self.time.now)), real(request, **kw))[1]
        start = threading.Barrier(2)
        pages = {}

        def work(path):
            start.wait()
            pages[path] = fetcher.get(server.base + path)

        threads = [threading.Thread(target=work, args=(path,)) for path in ("/a", "/b")]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(10)
        self.assertEqual({page.outcome for page in pages.values()}, {"ok"})
        self.assertEqual([url.rsplit("/", 1)[1] for url, _ in stamps].count("robots.txt"), 1)
        times = [at for _, at in stamps]
        self.assertEqual(len(times), 3)  # robots + two pages
        self.assertTrue(all(later - earlier >= fetch.MIN_INTERVAL for earlier, later in zip(times, times[1:])), times)
        self.assertEqual(self.time.sleeps, [5.0, 5.0])

    def test_a_block_seen_by_one_thread_stops_the_other_before_it_requests(self):
        server = serve(self, {"/a": (403, {}, "no")})
        fetcher = self.fetcher()
        start = threading.Barrier(2)
        outcomes = []

        def work():
            start.wait()
            outcomes.append(fetcher.get(server.base + "/a").outcome)

        threads = [threading.Thread(target=work) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(10)
        self.assertEqual(outcomes, ["blocked", "blocked"])
        self.assertEqual(self.pages(server), ["/a"])  # the second thread never reached the server

    def test_non_web_input_is_an_error_without_a_request(self):
        for raw in ("mailto:a@b.com", "", "http://["):
            page = self.fetcher().get(raw)
            self.assertEqual((page.outcome, page.domain, page.text), ("error", "", None), raw)

    def test_unreachable_domain_fails_fast_without_waiting_after_robots(self):
        port = self.closed_port()
        page = self.fetcher().get(f"http://127.0.0.1:{port}/")
        self.assertEqual(page.outcome, "dead")
        self.assertEqual(self.time.sleeps, [])  # the refused robots.txt set no pacing timestamp

    def test_private_and_loopback_addresses_are_refused_without_a_request(self):
        server = serve(self, {"/": html()})
        guarded = fetch.Fetcher(clock=FakeTime().clock, sleep=FakeTime().sleep)  # allow_private defaults to False
        for url in (server.base + "/", "http://10.0.0.1/", "http://169.254.169.254/latest/", "http://0.0.0.0/"):
            page = guarded.get(url)
            self.assertEqual((page.outcome, page.text), ("error", None), url)
        self.assertEqual(server.log, [])

    def test_a_name_resolving_to_a_private_address_is_refused(self):
        opener = FakeOpener({})
        resolve = lambda host, *args, **kw: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.168.1.5", 0))]
        page = fetch.Fetcher(opener=opener, clock=FakeTime().clock, sleep=FakeTime().sleep, resolve=resolve).get(
            "https://intranet.example.co.uk/")
        self.assertEqual(page.outcome, "error")
        self.assertEqual(opener.opened, [])

    def test_a_redirect_to_a_private_address_is_refused(self):
        opener = FakeOpener({"https://agent.example.co.uk/": (301, {"Location": "http://10.0.0.1/admin"}, b"")})
        page = fetch.Fetcher(opener=opener, clock=FakeTime().clock, sleep=FakeTime().sleep, resolve=PUBLIC).get(
            "https://agent.example.co.uk/")
        self.assertEqual((page.outcome, page.final_url), ("error", "http://10.0.0.1/admin"))
        self.assertEqual(opener.opened, ["https://agent.example.co.uk/robots.txt", "https://agent.example.co.uk/"])

    def test_a_dns_failure_is_dead_and_resolved_once_per_host(self):
        asked = []

        def resolve(host, *args, **kw):
            asked.append(host)
            raise socket.gaierror(socket.EAI_NONAME, "not known")

        opener = FakeOpener({})
        page = fetch.Fetcher(opener=opener, clock=FakeTime().clock, sleep=FakeTime().sleep, resolve=resolve).get(
            "https://elmestates.london/")
        self.assertEqual(page.outcome, "dead")
        self.assertEqual((asked, opener.opened), (["elmestates.london"], []))

    def test_www_host_robots_is_read_after_the_bare_host_was_unreachable(self):
        # kfh.co.uk and www.kfh.co.uk share one domain key: the dead bare host must not leave "no rules" behind
        def resolve(host, *args, **kw):
            if host == "kfh.co.uk":
                raise socket.gaierror(socket.EAI_NONAME, "not known")
            return PUBLIC(host)

        opener = FakeOpener({"https://www.kfh.co.uk/robots.txt": (200, {"Content-Type": "text/plain"},
                                                                   b"User-agent: CloseKnitBot\nDisallow: /\n"),
                             "https://www.kfh.co.uk/": (200, {"Content-Type": "text/html"}, HTML.encode())})
        fetcher = fetch.Fetcher(opener=opener, clock=FakeTime().clock, sleep=FakeTime().sleep, resolve=resolve)
        self.assertEqual(fetcher.get("https://kfh.co.uk/").outcome, "dead")
        self.assertEqual(fetcher.get("https://www.kfh.co.uk/").outcome, "robots")
        self.assertEqual(opener.opened, ["https://www.kfh.co.uk/robots.txt"])

    def test_shared_hosts_are_never_requested(self):
        opener = FakeOpener({"https://agent.example.co.uk/": (302, {"Location": "https://m.facebook.com/elm"}, b"")})
        fetcher = fetch.Fetcher(opener=opener, clock=FakeTime().clock, sleep=FakeTime().sleep, resolve=PUBLIC)
        self.assertEqual(fetcher.get("https://www.rightmove.co.uk/estate-agents/elm.html").outcome, "error")
        self.assertEqual(fetcher.get("https://agent.example.co.uk/").outcome, "error")
        self.assertEqual(opener.opened, ["https://agent.example.co.uk/robots.txt", "https://agent.example.co.uk/"])

    @staticmethod
    def closed_port():
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            return sock.getsockname()[1]


if __name__ == "__main__":
    unittest.main()
