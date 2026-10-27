import { fetchApi } from "@/lib/deployment";
import { evidenceServiceUrl } from "@/lib/evidence-service";

// Prod's Caddy sends /openapi.json to the API; a web-only host proxies it here, or 404s with no API.
export async function GET() {
  if (!evidenceServiceUrl()) return Response.json({ error: "not-found" }, { status: 404 });
  const { status, body } = await fetchApi<unknown>("/openapi.json");
  if (body === null) return Response.json({ error: "openapi-unavailable" }, { status: status === 0 ? 404 : status >= 400 ? status : 502 });
  return Response.json(body);
}
