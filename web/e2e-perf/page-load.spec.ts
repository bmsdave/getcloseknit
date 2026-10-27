import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { expect, test } from "@playwright/test";

/**
 * Area page load time (perf/layer-load/README.md, "Area pages"): the server's whole answer for an area page (HTML
 * read to its end), per level, for areas across England's regions. "first" is an area not asked for recently (the
 * first read of it in this run), "warm" the same page read again straight after.
 *
 * Budgets: warm ≤ PERF_PAGE_WARM_MS (600), first ≤ PERF_PAGE_FIRST_MS (1000), each area. PERF_STRICT_PAGES=1
 * (npm run perf:pages's default) fails over budget; 0 only reports. PERF_PAGE_LEVELS=lsoa,msoa,borough,region.
 * Each page is read as its own visitor (a fresh X-Forwarded-For), as production's API rate limit counts visitors.
 * Results are appended to PERF_OUT (default test-results/page-load.jsonl).
 */

const OUT = process.env.PERF_OUT ?? "test-results/page-load.jsonl";
const WARM_BUDGET = Number(process.env.PERF_PAGE_WARM_MS ?? 600);
const FIRST_BUDGET = Number(process.env.PERF_PAGE_FIRST_MS ?? 1000);
const STRICT = process.env.PERF_STRICT_PAGES === "1";
const LEVELS = (process.env.PERF_PAGE_LEVELS ?? "lsoa,msoa,borough,region").split(",");

/** Five areas per level in five regions (North East, North West, West Midlands, London, South West). */
export const PAGE_AREAS: Record<string, readonly string[]> = {
  lsoa: ["/area/lsoa/E01008860", "/area/lsoa/E01005180", "/area/lsoa/E01009050", "/area/lsoa/E01000775", "/area/lsoa/E01029123"],
  msoa: ["/area/msoa/E02001768", "/area/msoa/E02001062", "/area/msoa/E02001924", "/area/msoa/E02000596", "/area/msoa/E02006660"],
  borough: ["/area/lad/E06000057", "/area/lad/E08000015", "/area/lad/E07000219", "/area/lad/E09000028", "/area/lad/E07000045"],
  region: ["/area/london", "/area/england"],
};

let visitor = 0;

async function read(request: import("@playwright/test").APIRequestContext, path: string): Promise<{ ms: number; ok: boolean }> {
  visitor += 1;
  const started = performance.now();
  const response = await request.get(path, { headers: { "x-forwarded-for": `198.51.100.${visitor % 250}` }, maxRedirects: 0 });
  const body = await response.text();
  const ms = Math.round(performance.now() - started);
  const ok = response.status() === 200 && !body.includes("Page not found") && !body.includes('data-testid="page-unavailable"');
  return { ms, ok };
}

for (const level of LEVELS) {
  test(`area page load: ${level}`, async ({ request }) => {
    const over: string[] = [];
    for (const path of PAGE_AREAS[level] ?? []) {
      const first = await read(request, path);
      const warm = await read(request, path);
      const row = { at: new Date().toISOString(), level, path, firstMs: first.ms, warmMs: warm.ms, ok: first.ok && warm.ok,
        base: test.info().project.use.baseURL };
      mkdirSync(dirname(OUT), { recursive: true });
      appendFileSync(OUT, `${JSON.stringify(row)}\n`);
      console.log(`${level} ${path} first ${first.ms} ms, warm ${warm.ms} ms${row.ok ? "" : " NOT OK"}`);
      expect(row.ok, `${path} answered a page (not a 404 or "didn't load")`).toBe(true);
      if (warm.ms > WARM_BUDGET) over.push(`${path} warm ${warm.ms} ms > ${WARM_BUDGET}`);
      if (first.ms > FIRST_BUDGET) over.push(`${path} first ${first.ms} ms > ${FIRST_BUDGET}`);
    }
    if (STRICT) expect(over, "over budget").toEqual([]);
    else if (over.length) console.log(`over budget (report only): ${over.join("; ")}`);
  });
}
