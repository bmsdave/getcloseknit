/**
 * One request for an area's sections (opening the map with a selected area fired
 * 20-odd section reads at once and the API's per-viewer limit answered several with 429).
 *
 * The browser queues the section URLs one area view asks for within a few milliseconds and sends them
 * together to POST /api/v1/sections (app/api/v1/sections/route.ts). The web server reads each through
 * its own route handler, in process, as one render: the API charges the viewer one page view for the
 * lot, as it does for the area page's server render (lib/area-page-seed.ts). It streams one NDJSON line
 * per section as it is read, so each section shows as soon as it arrives, as it did on its own. Each
 * caller still gets a Response of its own, so the section hooks (lib/section-fetch.ts) do not change. A
 * URL the server sent no line for (a failed or slow read), or the whole batch failing, falls back to its
 * own request.
 *
 * Pure apart from fetch and timers: the server route and the tests share BATCH_PARTS and batchArea.
 */

export const SECTIONS_PATH = "/api/v1/sections";
/** At most this many URLs in one batch (one area's sections are about 25). */
export const MAX_BATCH = 40;
/** Section reads asked for within this window go together (a panel's sections mount in one commit). */
export const BATCH_DELAY_MS = 12;
const MAX_URL_LENGTH = 512;

/** /api/v1/areas/{id}/{part} parts the server reads in process ("" is the area's own evidence). */
export const BATCH_PARTS = [
  "", "civic", "council-tax", "flood", "future-transport", "health", "hmo", "home", "hpi", "kids", "layers", "location",
  "market", "market-by-type", "mobile", "nature", "noise", "ownership", "people", "pipeline", "places", "profile",
  "recent-sales", "rent-trend", "rents", "safety", "schools", "short-lets", "standouts",
] as const;
export type BatchPart = (typeof BATCH_PARTS)[number];
const PARTS: ReadonlySet<string> = new Set(BATCH_PARTS);
const AREA_URL = /^\/api\/v1\/areas\/([^/?#]+)(?:\/([a-z-]+))?(?:\?[^#]*)?$/;
/** A geography id ("uk:lsoa:E01000001"), never "names" or "boxes". */
const GEOGRAPHY_ID = /^[a-z]+:[a-z0-9-]+:[A-Za-z0-9-]+$/;

/** The area a section URL reads (its decoded id), or null when it cannot go in a batch. */
export function batchArea(url: string): string | null {
  if (typeof url !== "string" || url.length > MAX_URL_LENGTH) return null;
  const match = AREA_URL.exec(url);
  if (!match || !PARTS.has(match[2] ?? "")) return null;
  let id: string;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return GEOGRAPHY_ID.test(id) ? id : null;
}

/** Hands over one section the server read: its JSON body, null for a 404. */
export type DeliverSection = (url: string, body: unknown) => void;

/**
 * Reads the server's NDJSON answer ({url, body} per line) as it streams in, handing each section over
 * at once. A line that is not a section is skipped (its URL then falls back to its own read).
 */
export async function readSectionLines(stream: ReadableStream<Uint8Array>, deliver: DeliverSection): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  const line = (text: string) => {
    if (!text.trim()) return;
    try {
      const parsed = JSON.parse(text) as { url?: unknown; body?: unknown };
      if (typeof parsed?.url === "string" && "body" in parsed) deliver(parsed.url, parsed.body);
    } catch {
      // A cut line: its URL is read on its own.
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    buffered += decoder.decode(value, { stream: !done });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    lines.forEach(line);
    if (done) break;
  }
  line(buffered);
}

export interface SectionBatcher {
  /** A section URL's response: from a batch when it can go in one, else its own request. */
  read(url: string): Promise<Response>;
}

interface Waiting {
  resolve: (response: Response) => void;
  reject: (error: unknown) => void;
}

function jsonResponse(body: unknown): Response {
  return body === null
    ? new Response(JSON.stringify({ error: "not-found" }), { status: 404, headers: { "content-type": "application/json" } })
    : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

/**
 * `send` posts one batch, hands each section over as it arrives and settles when the answer ends (rejects
 * when the batch failed); `single` reads one URL on its own. Batches are per area: the server reads one
 * area's sections per request.
 */
export function createSectionBatcher(
  send: (urls: string[], deliver: DeliverSection) => Promise<void>,
  single: (url: string) => Promise<Response>,
  delayMs = BATCH_DELAY_MS,
): SectionBatcher {
  const queues = new Map<string, Map<string, Waiting[]>>();

  const settle = (waiting: Waiting[], response: Promise<Response>) => {
    // Each caller reads its own copy of the body, cloned before any is read.
    void response.then(
      (value) => {
        const copies = waiting.map((_, index) => (index === 0 ? value : value.clone()));
        waiting.forEach((entry, index) => entry.resolve(copies[index]));
      },
      (error: unknown) => waiting.forEach((entry) => entry.reject(error)),
    );
  };

  const flush = (area: string) => {
    const queue = queues.get(area);
    queues.delete(area);
    if (!queue) return;
    const entries = [...queue.entries()];
    for (let start = 0; start < entries.length; start += MAX_BATCH) {
      const chunk = entries.slice(start, start + MAX_BATCH);
      if (chunk.length === 1) {
        settle(chunk[0][1], single(chunk[0][0]));
        continue;
      }
      const waitingFor = new Map(chunk);
      const deliver: DeliverSection = (url, body) => {
        const waiting = waitingFor.get(url);
        if (!waiting) return;
        waitingFor.delete(url);
        settle(waiting, Promise.resolve(jsonResponse(body)));
      };
      void send(chunk.map(([url]) => url), deliver).catch(() => undefined).then(() => {
        // Whatever the answer did not carry is read on its own.
        for (const [url, waiting] of waitingFor) settle(waiting, single(url));
        waitingFor.clear();
      });
    }
  };

  return {
    read(url: string): Promise<Response> {
      const area = batchArea(url);
      if (!area) return single(url);
      return new Promise<Response>((resolve, reject) => {
        let queue = queues.get(area);
        if (!queue) {
          queue = new Map();
          queues.set(area, queue);
          setTimeout(() => flush(area), delayMs);
        }
        const waiting = queue.get(url) ?? [];
        waiting.push({ resolve, reject });
        queue.set(url, waiting);
      });
    },
  };
}
