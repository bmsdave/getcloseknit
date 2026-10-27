import { TOOLS, toolHref, type ToolSlug } from "./tools";

/**
 * The site's pages for the ≡ menu (components/site-menu.tsx), on the map and
 * in the header of every other page. One list, so the two never drift.
 * Menu v5 (owner board): five plain links (Find a place is the map),
 * then Tools and Learn as folds. Boroughs moved under Learn; AI agents came up
 * from it. Search is the pill, Glossary lives in the Guide and Teams in About.
 */
export interface SiteNavLink {
  label: string;
  href: string;
  testId?: string;
  /** Other paths this link marks as current: /school/… is under Schools. */
  also?: readonly string[];
}

export interface SiteNavGroup {
  id: "tools" | "learn";
  label: string;
  links: SiteNavLink[];
}

export type SiteNavEntry = SiteNavLink | SiteNavGroup;

export function isNavGroup(entry: SiteNavEntry): entry is SiteNavGroup {
  return "links" in entry;
}

function toolLink(slug: ToolSlug): SiteNavLink {
  return { label: TOOLS.find((tool) => tool.slug === slug)!.label, href: toolHref(slug) };
}

export const SITE_NAV: SiteNavEntry[] = [
  { label: "Find a place", href: "/" },
  { label: "My match", href: "/?layer=personal-match" },
  { label: "Rankings", href: "/rankings" },
  { label: "Schools", href: "/schools", also: ["/school"] },
  { label: "AI agents", href: "/agents" },
  {
    id: "tools",
    label: "Tools",
    links: [
      // The tool tabs' own names (lib/tools.ts), so the menu and the tabs never differ.
      ...(["check-a-home", "stamp-duty", "mortgage-rates", "investor"] as const).map(toolLink),
    ],
  },
  {
    id: "learn",
    label: "Learn",
    links: [
      { label: "Guide", href: "/guide" },
      { label: "Boroughs", href: "/area/london" },
      { label: "About", href: "/about" },
    ],
  },
];

/** The two folds. */
export const SITE_NAV_GROUPS: SiteNavGroup[] = SITE_NAV.filter(isNavGroup);

/** The small line under the map's menu; pages off the map have these in their footer. */
export const SITE_NAV_FOOTER: SiteNavLink[] = [
  { label: "Privacy", href: "/privacy", testId: "privacy-link" },
  { label: "Terms", href: "/terms", testId: "terms-link" },
  { label: "Feedback", href: "/feedback", testId: "feedback-link" },
];

/** Every page link of the menu, top-level and in folds, in menu order. */
export function siteNavLinks(): SiteNavLink[] {
  return SITE_NAV.flatMap((entry) => (isNavGroup(entry) ? entry.links : [entry]));
}

/** The menu link for the page shown: its own path or a page under it (/guide/… → Guide); none on the map. */
export function currentLink(pathname: string | null): SiteNavLink | null {
  if (!pathname || pathname === "/") return null;
  const links = siteNavLinks().filter((link) => !link.href.startsWith("/?") && link.href !== "/");
  const paths = (link: SiteNavLink) => [link.href.split("?")[0], ...(link.also ?? [])];
  return links.find((link) => paths(link).includes(pathname))
    ?? links.find((link) => paths(link).some((path) => pathname.startsWith(`${path}/`))) ?? null;
}

/** Every link the menu can show, for checks. */
export function siteNavHrefs(): string[] {
  return [...siteNavLinks(), ...SITE_NAV_FOOTER].map((link) => link.href);
}
