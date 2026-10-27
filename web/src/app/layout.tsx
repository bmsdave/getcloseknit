import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";

import "./globals.css";
import "../styles/layout.css";
import "../styles/feedback.css";
import "../styles/help.css";
import "../styles/trend.css";
import "../styles/subpage.css";
import "../styles/people.css";
import "../styles/overview.css";
import "../styles/places.css";
import "../styles/property.css";
import "../styles/market.css";
import "../styles/area-pages.css";
import "../styles/civic.css";
import "../styles/flood-risk.css";
import "../styles/nature.css";
import "../styles/hmo.css";
import "../styles/charts.css";
import "../styles/people-schools-charts.css";
import "../styles/housing-charts.css";
import "../styles/overview-tiles.css";
import "../styles/tailor.css";
import "../styles/rating.css";
import "../styles/environment-transport-charts.css";
import "../styles/sections.css";
import "../styles/area-title.css";
import "../styles/area-brief.css";
import "../styles/area-card.css";
import "../styles/area-v3.css";
import "../styles/home-actions.css";
import "../styles/knit-ui.css";
import "../styles/knit-tables.css";
import "../styles/knit-menu.css";
import "../styles/knit-legend.css";
// Global, not in the component: unit tests import evidence-panel.tsx, which mounts it.
import "../styles/area-save-actions.css";
import "../styles/homes-here.css";
import "../styles/entity-nav.css";
import "../styles/borough-page.css";
import "../styles/brand-lockup.css";
// Global, not in error.tsx: a root error boundary's sheet is preloaded on every page but
// applied only when an error shows, so browsers warn it went unused.
import "../styles/status-pages.css";
// Last: the one page width wins over any older per-page width.
import "../styles/page-shell.css";
import { HydrationMark } from "@/components/hydration-mark";
import { PwaRegistration } from "@/components/pwa-registration";
import { SiteFooter } from "@/components/site-footer";
import { UsageTracker } from "@/components/usage-tracker";
import { ScopeProvider } from "@/components/scope-context";
import { serverCoversEngland, serverScope } from "@/lib/deployment";
import { searchIndexable, siteDescription, SITE_NAME, siteOrigin, siteRobots, siteTitle } from "@/lib/seo";
import { AREA_ID_BOOT } from "@/lib/area-id-boot";
import { UI_THEME_BOOT } from "@/lib/ui-themes";
import { InlineScript } from "@/components/inline-script";

// DESIGN.md › Type: one family, Bricolage Grotesque (OFL, self-hosted: no network at build).
const bricolage = localFont({
  src: "./fonts/BricolageGrotesque-latin.woff2",
  weight: "200 800",
  display: "swap",
  variable: "--font-bricolage",
});

// The public origin resolves og:image and canonical URLs: CLOSE_KNIT_PUBLIC_URL, else this request's origin.
export async function generateMetadata(): Promise<Metadata> {
  const origin = await siteOrigin();
  // The first view's value line (lib/coverage-words), mirrored for links and tabs: England's when the map covers it.
  const england = await serverCoversEngland();
  const [title, description] = [siteTitle(england), siteDescription(england)];
  return {
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    title: { default: title, template: `%s · ${SITE_NAME}` },
    description,
    manifest: "/manifest.webmanifest",
    icons: { icon: "/icon.svg", apple: "/icon.svg" },
    // Link previews: the site card (app/opengraph-image.tsx) unless a page has its own.
    openGraph: { type: "website", siteName: SITE_NAME, locale: "en_GB", title, description },
    twitter: { card: "summary_large_image" },
    // Listed only when public (CLOSE_KNIT_ACCESS=public); a private preview is noindex (Caddy sends X-Robots-Tag too).
    robots: siteRobots(searchIndexable()),
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Draw under the notch and home indicator; the top bar, the sheet and
  // pages pad themselves with env(safe-area-inset-*).
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f7fa" },
    { media: "(prefers-color-scheme: dark)", color: "#16203a" },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const scope = await serverScope();
  return (
    <html lang="en-GB" className={bricolage.variable} suppressHydrationWarning>
      <head><InlineScript html={UI_THEME_BOOT} /><InlineScript html={AREA_ID_BOOT} /></head>
      <body><ScopeProvider scope={scope}><PwaRegistration /><UsageTracker />{children}<SiteFooter /><HydrationMark /></ScopeProvider></body>
    </html>
  );
}
