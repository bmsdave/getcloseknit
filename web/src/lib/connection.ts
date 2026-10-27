import type { ConnectionStatus, FetchLike } from "./map-state";
import { HEALTH_PATH } from "./section-seed";

/** While "Offline" shows, the API is asked again this often (ms). */
export const CONNECTION_PROBE_MS = 10_000;

interface EventSource {
  addEventListener(type: "online" | "offline", listener: () => void): void;
  removeEventListener(type: "online" | "offline", listener: () => void): void;
}

/**
 * The browser's own word on the connection (window's online/offline events):
 * the flag never waits for a reload or the next tap. Returns the unsubscribe.
 */
export function watchConnection(target: EventSource, set: (status: ConnectionStatus) => void): () => void {
  const online = () => set("online");
  const offline = () => set("offline");
  target.addEventListener("online", online);
  target.addEventListener("offline", offline);
  return () => {
    target.removeEventListener("online", online);
    target.removeEventListener("offline", offline);
  };
}

/**
 * Whether the API answers at all. Any HTTP response means the connection is
 * back (a 502/503 is the service restarting, not the visitor's network);
 * only a request that never gets an answer keeps "Offline".
 */
export async function probeConnection(fetchImpl: FetchLike, path: string = HEALTH_PATH): Promise<boolean> {
  try {
    await fetchImpl(path);
    return true;
  } catch {
    return false;
  }
}
