import type { MapDefinition } from "@/lib/contracts";
import { METRICS, PERSONAL_MATCH_DEFINITION } from "@/lib/fixtures";

/**
 * The guide is built once, without the evidence API, so it carries no
 * release: no freshness line, and a source link only when it points at the
 * real publisher (never a placeholder such as example.invalid).
 */
export function guideSourceUrl(metric: MapDefinition): string | null {
  try {
    const url = new URL(metric.provenance.sourceUrl);
    return url.protocol === "https:" && !url.hostname.endsWith(".invalid") ? url.href : null;
  } catch {
    return null;
  }
}

/** A map metric's published definition: description, caveats, source and licence. */
export function MetricNotes({ metricId }: { metricId: string }) {
  const metric: MapDefinition | undefined = [...METRICS, PERSONAL_MATCH_DEFINITION].find((entry) => entry.id === metricId);
  if (!metric) return null;
  const sourceUrl = guideSourceUrl(metric);
  return (
    <section className="guide-metric-notes" data-testid="guide-metric-notes">
      <p className="eyebrow">{metric.carrier.toUpperCase()}</p>
      <h3>{metric.label}</h3>
      <p>{metric.description}</p>
      <ul>{metric.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul>
      <p>Source: {sourceUrl ? <a href={sourceUrl}>{metric.provenance.sourceName}</a> : metric.provenance.sourceName}</p>
      <p className="licence-note">{metric.provenance.attribution}</p>
    </section>
  );
}
