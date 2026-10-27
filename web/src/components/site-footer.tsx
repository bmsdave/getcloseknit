import Link from "next/link";

import { contactMailto, NEWS_SUBJECT, RESEARCH_SUBJECT } from "@/lib/contact";

import { StemDivider } from "./knit/satin";
import { SiteFooterFrame } from "./site-footer-frame";
import "../styles/site-footer.css";

/** The ODbL places download (the merged places database, terms › places). */
export const PLACES_DOWNLOAD = "/api/v2/downloads/places.csv";

/** The trust links every page off the map carries, in reading order. */
export const FOOTER_LINKS: { href: string; label: string; testId: string }[] = [
  { href: "/privacy", label: "Sources & privacy", testId: "footer-privacy" },
  { href: "/terms", label: "Terms", testId: "footer-terms" },
  { href: "/terms#reuse", label: "Licences", testId: "footer-licences" },
  { href: PLACES_DOWNLOAD, label: "Places data (ODbL)", testId: "footer-odbl" },
  { href: "/guide/demo-vs-real", label: "Real or demo data", testId: "footer-data-mode" },
  { href: "/privacy#hide-my-home", label: "Report or hide a home", testId: "footer-hide-home" },
  { href: "/about", label: "About", testId: "footer-about" },
  { href: "/feedback", label: "Feedback", testId: "footer-feedback" },
  { href: "/about#teams", label: "For teams", testId: "footer-teams" },
];

/**
 * The shared footer of every page off the map (UX P7): where the figures come
 * from, the terms and licences, how to correct or hide a home, who runs Close
 * Knit, and two e-mail links for news and research sessions
 * (proposal #17: a mailto, nothing collected here). The contact address is
 * read on the server (lib/contact.ts); print hides the footer.
 */
export function SiteFooter() {
  return (
    <SiteFooterFrame>
      <footer className="site-footer" data-testid="site-footer">
        <StemDivider className="site-footer__seam" />
        <nav className="site-footer__nav" aria-label="About this site">
          {FOOTER_LINKS.map((link) => link.href.startsWith("/api/")
            ? <a key={link.testId} href={link.href} data-testid={link.testId}>{link.label}</a>
            : <Link key={link.testId} href={link.href} data-testid={link.testId}>{link.label}</Link>)}
        </nav>
        <p className="site-footer__pledge">Independent: no paid placement, no lead selling, and rankings are never sold.</p>
        <p className="site-footer__mail">
          <span>By e-mail, nothing stored here:</span>
          <a href={contactMailto(NEWS_SUBJECT)} data-testid="footer-launch-list">{NEWS_SUBJECT}</a>
          <a href={contactMailto(RESEARCH_SUBJECT)} data-testid="footer-research">{RESEARCH_SUBJECT}</a>
        </p>
      </footer>
    </SiteFooterFrame>
  );
}
