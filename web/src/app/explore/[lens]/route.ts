import { exploreRedirect, permanentRedirectResponse } from "@/lib/explore-redirect";

// /explore/<lens> is gone: the map opens coloured by that lens.
export async function GET(_request: Request, context: { params: Promise<{ lens: string }> }) {
  return permanentRedirectResponse(exploreRedirect((await context.params).lens));
}
