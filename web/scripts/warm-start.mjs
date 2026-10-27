/**
 * The web container's entry (web/Dockerfile, next to the standalone server.js). It starts the Next.js server on a
 * loopback port, reads one URL per page template (scripts/warm-up.mjs) and only then opens the public port with
 * the same request handler, so the first visitor after a deploy or restart meets a warm server. Until then a
 * connection is refused, which Caddy retries for 30 s (deploy/Caddyfile lb_try_duration) and the healthcheck
 * fails, so the port opens after WARM_BUDGET_MS at the latest (the rest of the warm-up goes on behind it).
 * Other regions' data (REGION_PATHS) is read after that, one region at a time behind the open port: all at once
 * right after start-up (8 boroughs, ~20 s, when each region's index sorted ~35,000 names with a new collator per
 * comparison) slowed the first visitors' pages two- to fourfold on production.
 * CLOSE_KNIT_WARM_UP=0 (or a non-production NODE_ENV) starts server.js as it is.
 */
import http from "node:http";
import net from "node:net";

import { REGION_PATHS, summary, warm, WARM_PATHS } from "./warm-up.mjs";

const WARM_BUDGET_MS = 20_000;
// Production pages wait on the API, so more at once only queue there: all templates took 29 s one at a time,
// 19 s four at a time, 18 s six at a time.
const CONCURRENCY = 4;
const LISTEN_TIMEOUT_MS = 30_000;
/** The region pass waits this long after the templates, so the first visitors' pages come first. */
const REGION_DELAY_MS = 10_000;

const publicPort = Number(process.env.PORT) || 4180;
const publicHost = process.env.HOSTNAME || "0.0.0.0";

if (process.env.CLOSE_KNIT_WARM_UP === "0" || process.env.NODE_ENV !== "production") {
  await import("./server.js");
} else {
  await startWarm();
}

async function startWarm() {
  const started = performance.now();
  const innerPort = publicPort + 1;
  const inner = `http://127.0.0.1:${innerPort}`;
  // server.js reads PORT and HOSTNAME once, then creates its one HTTP server: keep that server to serve the
  // public port with the same handlers later.
  process.env.PORT = String(innerPort);
  process.env.HOSTNAME = "127.0.0.1";
  // Next's own SIGTERM handling would close only the loopback server and exit mid-request: stop closes both
  // (finishing the requests in flight), as Next did with its one server.
  process.env.NEXT_MANUAL_SIG_HANDLE = "1";
  const servers = [];
  const stop = (code) => () => Promise.all(servers.map((server) => new Promise((resolve) => server.close(() => resolve()))))
    .then(() => process.exit(code));
  process.once("SIGTERM", stop(143));
  process.once("SIGINT", stop(130));
  const createServer = http.createServer;
  let nextServer = null;
  http.createServer = (...args) => {
    http.createServer = createServer;
    nextServer = createServer(...args);
    servers.push(nextServer);
    return nextServer;
  };
  await import("./server.js");
  await listening(innerPort);

  const pages = warm(inner, WARM_PATHS, { concurrency: CONCURRENCY })
    .then((results) => console.log(summary("templates", results, Math.round(performance.now() - started))));
  const capped = await Promise.race([pages.then(() => false), sleep(WARM_BUDGET_MS).then(() => true)]);
  if (capped) console.warn(`warm-up: still running after ${WARM_BUDGET_MS} ms; opening the port`);
  servers.push(openPublic(nextServer, innerPort));
  console.log(`warm-up: serving ${publicHost}:${publicPort} after ${Math.round(performance.now() - started)} ms`);
  // Then the other regions' data, one region at a time once the templates are done, behind the open port.
  void pages.then(() => sleep(REGION_DELAY_MS)).then(async () => {
    const regionsStarted = performance.now();
    const results = await warm(inner, REGION_PATHS, { concurrency: 1 });
    console.log(summary("regions", results, Math.round(performance.now() - regionsStarted)));
  });
}

/** The public port, served by Next's own handlers; a plain TCP relay to the loopback port if they were not caught. */
function openPublic(nextServer, innerPort) {
  let server;
  if (nextServer) {
    server = http.createServer();
    for (const listener of nextServer.listeners("request")) server.on("request", listener);
    for (const listener of nextServer.listeners("upgrade")) server.on("upgrade", listener);
    server.keepAliveTimeout = nextServer.keepAliveTimeout;
  } else {
    console.error("warm-up: Next.js did not create its server through http.createServer; relaying the public port over TCP");
    server = net.createServer((socket) => {
      const upstream = net.connect(innerPort, "127.0.0.1");
      socket.pipe(upstream).pipe(socket);
      socket.on("error", () => upstream.destroy());
      upstream.on("error", () => socket.destroy());
    });
  }
  server.on("error", (error) => {
    console.error("warm-up: cannot open the public port", error);
    process.exit(1);
  });
  server.listen(publicPort, publicHost);
  return server;
}

/** Resolves once something accepts connections on 127.0.0.1:`port`; exits the process after LISTEN_TIMEOUT_MS. */
async function listening(port) {
  const deadline = Date.now() + LISTEN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const open = await new Promise((resolve) => {
      const socket = net.connect(port, "127.0.0.1", () => { socket.end(); resolve(true); });
      socket.on("error", () => resolve(false));
    });
    if (open) return;
    await sleep(100);
  }
  console.error(`warm-up: the Next.js server did not listen on ${port} within ${LISTEN_TIMEOUT_MS} ms`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}
