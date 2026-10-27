import type { Metadata } from "next";

import { NOT_FOUND_METADATA } from "@/lib/seo";

import { NotFoundView } from "./not-found-view";

// Next already marks every 404 noindex; dropping the layout's robots keeps that the only robots tag
// (never "index, follow" or a second noindex beside it). Its own title, never the home page's.
export const metadata: Metadata = { ...NOT_FOUND_METADATA, robots: null };

export default function NotFound() {
  return <NotFoundView />;
}
