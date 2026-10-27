/**
 * The web server's start-up warm-up (scripts/warm-start.mjs, the container's entry). After a restart the first
 * request to each page template paid 0.3–1.3 s of Next.js start-up (route modules, server components, the
 * in-process loaders of lib/deployment.ts and lib/area-pages-data.ts) on top of its data. One representative URL
 * per page template is read over loopback before the public port opens; tests/warm-up.test.ts fails when a page
 * template under src/app has none.
 *
 * Plain GETs from 127.0.0.1: no browser runs them, so no analytics event is sent, and the API charges their reads
 * to the web container's own address (api/area_api/ratelimit.py), never to a visitor's.
 */

/** Sent with every warm-up request, so access logs can tell it apart. */
export const WARM_UP_AGENT = "close-knit-warm-up";

/**
 * One URL per page template: London examples that exist in production (in demo some 404, which still loads the
 * template). Slowest first (each ~3 s warm on production, London's area pages data on top for the first ones), so
 * the pages still running when the budget opens the port are the quick ones.
 */
export const WARM_PATHS = [
  "/area/lad/E09000001",
  "/area/msoa/E02000001",
  "/compare?ids=uk:msoa:E02000001",
  "/schools",
  "/",
  "/property/10012791471",
  "/property/at/N1-1LX/281-liverpool-road",
  "/area/lsoa/E01000001",
  "/postcode/N1-0AA",
  "/rankings",
  "/area/london",
  "/school/100000",
  "/area/msoa/E02000001/pack",
  "/area/msoa/E02000001/places",
  "/area/england",
  "/postcode/N1-0AA/homes",
  "/rankings/highest-income",
  "/sector/N1-0",
  "/about",
  "/agents",
  "/agents/chatgpt",
  "/agents/claude-code",
  "/bot",
  "/brief",
  "/civic",
  "/feedback",
  "/guide",
  "/guide/glossary",
  "/guide/reading-the-map",
  "/privacy",
  "/privacy/legitimate-interests",
  "/save-listing",
  "/terms",
  "/tools",
  "/tools/check-a-home",
  "/tools/investor",
  "/tools/mortgage-rates",
  "/tools/stamp-duty",
];

/**
 * One borough (local authority) page per English region outside London, read one at a time after the port opens:
 * each loads its region's area pages data (lib/area-pages-data.ts), kept for the process's life and reloaded hourly
 * behind the pages, so no visitor waits seconds for a region's first page. With CLOSE_KNIT_ENGLAND off they 404.
 */
export const REGION_PATHS = [
  "/area/lad/E08000003", // North West: Manchester
  "/area/lad/E07000178", // South East: Oxford
  "/area/lad/E08000025", // West Midlands: Birmingham
  "/area/lad/E08000035", // Yorkshire and The Humber: Leeds
  "/area/lad/E07000008", // East of England: Cambridge
  "/area/lad/E06000023", // South West: Bristol
  "/area/lad/E06000018", // East Midlands: Nottingham
  "/area/lad/E08000021", // North East: Newcastle upon Tyne
];

/** Page templates left out on purpose, with why. */
export const SKIPPED_TEMPLATES = {
  "/dev/charts": "a development page: 404 in production",
};

/**
 * GETs each path from `origin`, `concurrency` at a time; never throws. Status 0 is a failed or timed-out read.
 * @param {string} origin
 * @param {readonly string[]} paths
 * @param {{ concurrency?: number, timeoutMs?: number, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<{ path: string, status: number, ms: number }[]>}
 */
export async function warm(origin, paths, { concurrency = 4, timeoutMs = 20_000, fetchImpl = fetch } = {}) {
  const queue = [...paths];
  const results = [];
  async function worker() {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      const started = performance.now();
      let status = 0;
      try {
        const response = await fetchImpl(origin + path, {
          redirect: "manual", headers: { "user-agent": WARM_UP_AGENT }, signal: AbortSignal.timeout(timeoutMs),
        });
        await response.arrayBuffer();
        status = response.status;
      } catch {
        status = 0;
      }
      results.push({ path, status, ms: Math.round(performance.now() - started) });
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return results;
}

/** One log line: how long, how many, the reads over a second, and every read that did not answer 200. */
export function summary(label, results, ms) {
  const slow = results.filter((result) => result.ms >= 1000).sort((a, b) => b.ms - a.ms).map((result) => `${result.path} ${result.ms} ms`);
  const odd = results.filter((result) => result.status !== 200).map((result) => `${result.path} ${result.status || "failed"}`);
  return `warm-up: ${label} ${results.length} pages in ${ms} ms` + (slow.length ? `; over 1 s: ${slow.join(", ")}` : "")
    + (odd.length ? `; not 200: ${odd.join(", ")}` : "");
}
