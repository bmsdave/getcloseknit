import Link from "next/link";
import { Suspense } from "react";

import { KnitIcon } from "@/components/knit/knit-icon";
import { homesWord, loadHomesNear, nearDistance, type NearPostcode } from "@/lib/homes-near";
import type { DataMode } from "@/lib/map-state";
import { postcodeHomesPath } from "@/lib/property-profile";

type Point = { latitude: number; longitude: number } | null;

/** Streams in after the school card (the nearest-postcodes read must not hold the page). */
export function HomesNearStreamed({ point, mode, areaHref }: { point: Point; mode: DataMode; areaHref: string | null }) {
  return (
    <Suspense fallback={<HomesNear rows="loading" areaHref={areaHref} />}>
      <HomesNearLoaded point={point} mode={mode} areaHref={areaHref} />
    </Suspense>
  );
}

async function HomesNearLoaded({ point, mode, areaHref }: { point: Point; mode: DataMode; areaHref: string | null }) {
  return <HomesNear rows={await loadHomesNear(point, mode)} areaHref={areaHref} />;
}

/**
 * "Homes near this school", near the top of the school page. The nearest postcodes with
 * recorded homes, each a link to its homes (never the school's own postcode when only the school is
 * there). Null rows: the read failed, said in one muted line; the area link stays as the way on.
 */
export function HomesNear({ rows, areaHref }: { rows: NearPostcode[] | null | "loading"; areaHref: string | null }) {
  return (
    <section className="sc-section sc-near" id="homes-near" data-testid="school-homes-near" aria-labelledby="sc-homes-near">
      <h2 className="sc-h2" id="sc-homes-near">
        <KnitIcon name="home" className="sc-h2__icon" />
        <span>Homes near this school</span>
      </h2>
      {rows === "loading" ? (
        <p className="sc-unknown" role="status" aria-busy="true">Finding homes near…</p>
      ) : rows === null ? (
        <p className="sc-unknown" role="status">Couldn&apos;t load homes near. Try again later.</p>
      ) : rows.length === 0 ? (
        <p className="sc-unknown">No recorded homes within 800 m.</p>
      ) : (
        <>
          <ul className="sc-near__list">
            {rows.map((row) => (
              <li key={row.postcode}>
                <Link className="sc-near__link" href={postcodeHomesPath(row.postcode)} data-testid="school-homes-near-postcode">
                  <strong>{row.postcode}</strong>
                  <span>{homesWord(row.homes)} · {nearDistance(row.metres)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="sc-fine">Straight line from the school. Not a catchment.</p>
        </>
      )}
      {areaHref && (
        <p className="sc-homes">
          <Link href={areaHref} data-testid="school-area-link">
            <KnitIcon name="home" className="sc-icon" /> The area around it
          </Link>
        </p>
      )}
    </section>
  );
}
