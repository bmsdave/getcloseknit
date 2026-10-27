/**
 * Schools 101 (Menu v5 board): the short cards on /schools, each opening its section of the long
 * article /guide/schools-101 (components/guide/articles.tsx). `id` is the section's anchor there.
 */
export interface Schools101Card {
  id: string;
  topic: string;
  title: string;
  text: string;
}

export const SCHOOLS_101_PATH = "/guide/schools-101";

export const SCHOOLS_101: readonly Schools101Card[] = [
  {
    id: "phases", topic: "Phases", title: "Nursery to sixth form",
    text: "Nursery 3–4 · Primary 4–11 (Reception, Years 1–6) · Secondary 11–16 (Years 7–11, GCSEs) · Sixth form 16–18 (A levels, T levels).",
  },
  {
    id: "types", topic: "School types", title: "Community, academy, free, faith, grammar, independent",
    text: "All state schools are free. Academies and free schools set their own admissions; grammars test at 10 or 11; independent schools charge fees.",
  },
  {
    id: "ofsted", topic: "Ofsted", title: "The four grades",
    text: "Until 2024: Outstanding, Good, Requires improvement or Inadequate as one overall grade. Many schools still show one; check its year.",
  },
  {
    id: "report-cards", topic: "Ofsted since 2025", title: "Report cards, no single grade",
    text: "Inspections since November 2025 grade several areas, from exceptional to urgent improvement. We never merge them with an older grade.",
  },
  {
    id: "ks2", topic: "Primary results", title: "Key stage 2 (SATs)",
    text: "Tests at 11 in reading, maths and grammar; writing is teacher-assessed. Headline: share of pupils at the expected standard in all three.",
  },
  {
    id: "attainment-progress", topic: "Secondary results", title: "Attainment 8 and Progress 8",
    text: "Attainment 8: grades across eight GCSEs; 50 is about a grade 5 each. Progress 8: gain since 11 against similar pupils; 0 is average.",
  },
  {
    id: "grade-5", topic: "Secondary results", title: "Grade 5 in English and maths, EBacc",
    text: "GCSEs run 9 (top) to 1; 4 is a standard pass, 5 a strong pass. EBacc: English, maths, sciences, a language, history or geography.",
  },
  {
    id: "catchment", topic: "Admissions", title: "Catchment and last distance offered",
    text: "Full schools rank by rules: children in care, often siblings, then distance. The last distance offered changes every year: a hint, not a place.",
  },
  {
    id: "faith", topic: "Admissions", title: "Faith criteria",
    text: "A full faith school may put families of its faith first, often with a form and a reference of worship. Read its own rules.",
  },
  {
    id: "appeals", topic: "Admissions", title: "Appeals and waiting lists",
    text: "Refused a place? Join the waiting list and appeal to an independent panel. Infant classes are capped at 30, so those appeals rarely win.",
  },
  {
    id: "key-dates", topic: "Key dates", title: "Apply in autumn, hear in spring",
    text: "Secondary: apply by 31 October, offers 1 March. Primary: by 15 January, offers 16 April. One form to your council, six choices in London.",
  },
  {
    id: "guide-how", topic: "How we rank", title: "What a top list means here",
    text: "One published measure, one phase, London state schools, latest year. A rank says nothing about fit or admissions.",
  },
];

export function schools101Href(card: Schools101Card): string {
  return `${SCHOOLS_101_PATH}#${card.id}`;
}
