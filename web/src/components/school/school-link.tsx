import Link from "next/link";
import type { ComponentProps } from "react";

// The app-router Link reads unstable_dynamicOnHover (Next 16); next/link's public types do not list it yet.
const ON_HOVER = { unstable_dynamicOnHover: true } as Record<string, unknown>;

/**
 * A link to a school page that renders it fully in the background on hover or touch, so the click opens it
 * at once. Only the school about to be opened is fetched: a list of fifty costs nothing until one is pointed at.
 */
export function SchoolLink(props: ComponentProps<typeof Link>) {
  return <Link {...props} {...ON_HOVER} />;
}
