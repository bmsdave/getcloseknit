import type { Crumb } from "@/lib/entity-nav";
import { breadcrumbJsonLd, siteOrigin } from "@/lib/seo";

/** Server only: the page's visible crumbs (Breadcrumbs) as schema.org BreadcrumbList; `path` is this page. */
export async function BreadcrumbData({ crumbs, path }: { crumbs: readonly Crumb[]; path: string }) {
  const origin = await siteOrigin();
  const data = origin ? breadcrumbJsonLd(origin, crumbs, path) : null;
  return data ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: data }} /> : null;
}
