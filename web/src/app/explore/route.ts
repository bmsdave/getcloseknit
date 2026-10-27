import { exploreRedirect, permanentRedirectResponse } from "@/lib/explore-redirect";

// /explore is gone: its lenses are the map's Layers › My criteria.
export function GET() {
  return permanentRedirectResponse(exploreRedirect(null));
}
