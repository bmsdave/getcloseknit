import Link from "next/link";

import { GUIDANCE_LINKS, PROFESSIONAL_PROMPT } from "@/lib/leasehold";
import { toolHref } from "@/lib/tools";

import { Term } from "./term";

/**
 * Leasehold, in a few lines: what to ask for in writing (the questions sit
 * in "Questions to ask the agent" below), who reads the lease, and where to
 * get free advice. It replaces the long due-diligence form: a tenure flag is
 * not an answer, and the lease itself needs a solicitor, not a form.
 */
export function LeaseholdChecklist({ defaultPrice = null }: { defaultPrice?: number | null }) {
  return (
    <section className="leasehold-note" data-testid="leasehold-note" aria-labelledby="leasehold-note-title">
      <h3 id="leasehold-note-title">If it is leasehold</h3>
      <p>
        Ask the agent for the years left on the <Term id="leasehold">lease</Term>, the <Term id="service-charge">service charge</Term>,
        the <Term id="ground-rent">ground rent</Term> and any major works in writing. {PROFESSIONAL_PROMPT}
      </p>
      <p className="leasehold-note__links">
        {GUIDANCE_LINKS.map((link) => (
          <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">{link.label} ↗</a>
        ))}
        <Link href={toolHref("stamp-duty", { price: defaultPrice })}>Stamp duty on this price</Link>
      </p>
    </section>
  );
}
