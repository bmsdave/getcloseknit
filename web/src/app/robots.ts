import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { robotsRules, searchIndexable, siteOrigin } from "@/lib/seo";

/** Read per request: CLOSE_KNIT_ACCESS is the container's, not the build's (lib/seo.ts › searchIndexable). */
export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();
  return robotsRules(await siteOrigin(), searchIndexable());
}
