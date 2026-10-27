import { OFSTED_SWATCH_VIEWBOX, ofstedSwatchMarkup, type OfstedMark } from "@/lib/school-icons";

/** The label is set as markup: escape it (on the area page it carries the grade's words from the data). */
const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The Ofsted swatch: the map cap's top board in the grade's colour (Outstanding green,
 * Good blue, Requires improvement amber, Inadequate red, report card grey; null = not inspected, plain sun),
 * so the popup, the legend, the area page's school rows and the school page all match the map. The words
 * are its label.
 */
export function OfstedIcon({ mark, label, size = 20, className = "school-pop__ofsted" }: {
  /** null: no label, the words beside it say the grade (the swatch is then hidden from screen readers). */
  mark: OfstedMark | null; label: string | null; size?: number; className?: string;
}) {
  // Our own markup (lib/school-icons.ts): the same top as on the map's cap.
  const named = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  return (
    <svg className={className} width={size} height={Math.round(size * 0.55)} viewBox={OFSTED_SWATCH_VIEWBOX} {...named}
      data-ofsted={mark ?? "none"}
      dangerouslySetInnerHTML={{ __html: `${label ? `<title>${escapeText(label)}</title>` : ""}${ofstedSwatchMarkup(mark)}` }} />
  );
}
