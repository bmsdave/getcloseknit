import Link from "next/link";

import { OfstedIcon } from "@/components/school/ofsted-icon";
import { OFSTED_LABEL, type OfstedMark } from "@/lib/school-icons";
import { SCHOOLS_101, schools101Href } from "@/lib/schools-101";

const LEGACY_GRADES: readonly OfstedMark[] = ["outstanding", "good", "requires-improvement", "inadequate"];

/** Schools 101 on /schools: one short card per topic, each opening its section of /guide/schools-101. */
export function Schools101Grid() {
  return (
    <ul className="schools-101" data-testid="schools-101-grid">
      {SCHOOLS_101.map((card) => (
        <li key={card.id} className="schools-101__card" data-testid={`schools-101-${card.id}`}>
          <span className="schools-101__topic">{card.topic}</span>
          <h3>{card.title}</h3>
          <p>{card.text}</p>
          {/* The old grades as the map's swatches (graphics over text). */}
          {card.id === "ofsted" && (
            <ul className="schools-101__grades" aria-label="Ofsted grades until 2024">
              {LEGACY_GRADES.map((mark) => (
                <li key={mark}><OfstedIcon mark={mark} label={null} size={18} className="schools-table__swatch" />{OFSTED_LABEL[mark]}</li>
              ))}
            </ul>
          )}
          <Link href={schools101Href(card)} className="schools-101__more">
            Read more<span className="sr-only">: {card.title}</span> <span aria-hidden="true">→</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
