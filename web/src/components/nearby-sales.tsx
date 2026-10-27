"use client";

import { useEffect, useState } from "react";

import type { AddressId, NearbySaleGroup, NearbySales } from "@/lib/contracts";
import { formatPounds } from "@/lib/evidence-format";
import { formatDay } from "@/lib/market";
import { nearbyCountText, nearbyMedianText, nearbySaleLabel } from "@/lib/nearby-sales";
import { loadDisplayPrefs, type AreaUnit } from "@/lib/profile-state";
import { BarList, ChartFrame, type BarRow } from "./charts";
import { Term } from "./term";

/**
 * Other homes' recorded sales in this building and on this street (no
 * per-sale floor area): a bar per matched group with its sale count, then
 * each group's median and newest sales. The disclaimer folds under the chart.
 */
export function NearbySalesSection({ addressId }: { addressId: AddressId }) {
  const nearby = useNearbySales(addressId);
  const [unit, setUnit] = useState<AreaUnit>("sqm");
  useEffect(() => setUnit(loadDisplayPrefs().areaUnit), []);
  if (!nearby) return null;
  return (
    <section className="property-history nearby-sales" data-testid="nearby-sales">
      <p className="eyebrow">Sales nearby</p>
      <h2>In this building and on this street</h2>
      <p className="term-row">
        From HM Land Registry <Term id="price-paid" />, other homes only.
      </p>
      <ChartFrame title={`Sales in the last ${nearby.windowYears} years`} sources={<p>{nearby.disclaimer}</p>}>
        <BarList label="Recorded sales of other homes" rows={countRows(nearby)} />
      </ChartFrame>
      <NearbyGroup title="Same building" testId="nearby-building" group={nearby.building}
        windowYears={nearby.windowYears} unit={unit} empty="No other recorded sales in this building." />
      <NearbyGroup title="Same street, other buildings" testId="nearby-street" group={nearby.street}
        windowYears={nearby.windowYears} unit={unit} empty="No other recorded sales on this street." />
    </section>
  );
}

/** One bar per group that could be matched: its sale count in the window. */
function countRows(nearby: NearbySales): BarRow[] {
  const groups: Array<[string, string, NearbySaleGroup | null]> = [
    ["building", "Same building", nearby.building],
    ["street", "Same street", nearby.street],
  ];
  return groups.flatMap(([id, label, group]) => group === null ? [] : [{
    id, label, value: group.saleCount, display: `${group.saleCount} ${group.saleCount === 1 ? "sale" : "sales"}`,
  }]);
}

/** Newest sales shown per group before "Show all". */
const NEARBY_PREVIEW = 5;

function NearbyGroup({ title, testId, group, windowYears, unit, empty }: {
  title: string;
  testId: string;
  group: NearbySaleGroup | null;
  windowYears: number;
  unit: AreaUnit;
  empty: string;
}) {
  const [all, setAll] = useState(false);
  if (group === null) {
    return (
      <div data-testid={testId}>
        <h3>{title}</h3>
        <p className="metric-description">Not available: this address&apos;s sale record has no building or street to match on.</p>
      </div>
    );
  }
  return (
    <div data-testid={testId}>
      <h3>{title}</h3>
      {group.saleCount === 0 ? <p className="metric-description">{empty}</p> : (
        <>
          <p className="metric-description">{nearbyCountText(group, windowYears)}</p>
          <p data-testid={`${testId}-median`}>{nearbyMedianText(group, unit)}</p>
          <div id={`${testId}-list`}>
            {(all ? group.sales : group.sales.slice(0, NEARBY_PREVIEW)).map((sale, index) => (
              <article key={`${sale.date}-${sale.nominalPrice}-${index}`}>
                <strong>{formatPounds(sale.nominalPrice)}</strong><time dateTime={sale.date}>{formatDay(sale.date)}</time>
                <p>{nearbySaleLabel(sale)}</p>
              </article>
            ))}
          </div>
          {group.sales.length > NEARBY_PREVIEW && (
            <button type="button" className="chip-button" data-testid={`${testId}-all`} aria-expanded={all}
              aria-controls={`${testId}-list`} onClick={() => setAll((open) => !open)}>
              {all ? "Show fewer" : `Show all ${group.sales.length} sales`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function useNearbySales(addressId: AddressId) {
  const [nearby, setNearby] = useState<NearbySales | null>(null);
  useEffect(() => {
    setNearby(null);
    const controller = new AbortController();
    void fetch(`/api/v1/addresses/${encodeURIComponent(addressId)}/nearby-sales`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: NearbySales | null) => setNearby(payload?.schemaVersion === "nearby-sales.v1" ? payload : null))
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        console.error("Close Knit nearby sales request failed", error);
      });
    return () => controller.abort();
  }, [addressId]);
  return nearby;
}
