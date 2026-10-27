"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { pageTailor, tailorLine } from "@/lib/area-tailor";
import {
  barColour, COMPARE_KINDS, compareHref, MAX_COMPARE_COLUMNS, withSearchRows, type CompareKind, type CompareTable,
} from "@/lib/compare-table";
import type { GeographyId, PreferenceProfile } from "@/lib/contracts";
import { titleDistrict } from "@/lib/portal-zones";
import { DEFAULT_PROFILE } from "@/lib/fixtures";
import type { DataMode } from "@/lib/map-state";
import { searchCriteria, searchKey } from "@/lib/match-search";
import { isUnsetProfile, loadLocalProfile } from "@/lib/profile-state";
import { useSaved, type SavedSnapshot } from "@/lib/saved-items";
import { SAVED_HREF } from "@/lib/saved-panel";
import { areasBriefHref } from "@/lib/saved-shortlists";
import { Breadcrumbs } from "./entity-nav";
import { KnitIcon } from "./knit/knit-icon";
import { SatinBar } from "./knit/satin";
import { AreaPortalLinks } from "./match/portal-links";
import { useShareLink } from "./match/share-link";
import { useSearchPack } from "./match/use-search-pack";
import "../styles/compare.css";

/** "Highbury East" then " · N5" in its own span, which a phone leaves out. */
function ColumnName({ name }: { name: string }) {
  const at = name.lastIndexOf(" · ");
  if (at < 0) return <>{name}</>;
  return <>{name.slice(0, at)}<span className="compare-col__district"> · {name.slice(at + 3)}</span></>;
}

/** The brief for the areas side by side and this browser's own search; null for schools or homes, or until read. */
function useAreasBrief(table: CompareTable, source?: { mode: DataMode; release: string }): string | null {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    if (table.kind !== "places" || !source) return;
    setHref(areasBriefHref({
      candidates: table.columns.map((column) => column.id as GeographyId),
      candidateNames: Object.fromEntries(table.columns.map((column) => [column.id, column.name])),
      profile: loadLocalProfile(DEFAULT_PROFILE), mode: source.mode, release: source.release,
    }));
  }, [table, source]);
  return href;
}

/** The saved ids of one kind, as /compare takes them. */
export function savedIdsFor(kind: CompareKind, saved: SavedSnapshot): string[] {
  if (kind === "places") return saved.areas.map((area) => area.geographyId);
  if (kind === "homes") return saved.homes.flatMap((home) => (home.uprn ? [home.uprn] : []));
  return saved.items.filter((item) => item.kind === "school").map((item) => item.id);
}

function KindTabs({ kind }: { kind: CompareKind }) {
  return (
    <nav className="compare-kinds" aria-label="Compare">
      {COMPARE_KINDS.map((entry) => (
        <Link key={entry.id} href={compareHref(entry.id, [])} aria-current={entry.id === kind ? "page" : undefined}
          data-testid={`compare-kind-${entry.id}`}>{entry.label}</Link>
      ))}
    </nav>
  );
}

/** /compare with no ids: the saved ones of that kind, or how to get some. */
export function CompareFromSaved({ kind }: { kind: CompareKind }) {
  const saved = useSaved();
  const router = useRouter();
  const ids = savedIdsFor(kind, saved);
  const href = ids.length > 0 ? compareHref(kind, ids) : null;
  useEffect(() => {
    if (href) router.replace(href);
  }, [href, router]);
  return (
    <>
      <h1>Compare</h1>
      <KindTabs kind={kind} />
      {ids.length === 0 && (
        <p className="compare-empty" data-testid="compare-empty">
          Nothing saved to compare yet. <Link href={SAVED_HREF}>Open Saved</Link>
        </p>
      )}
    </>
  );
}

/**
 * Compare v2: one kind side by side. Each row marks its best value (where better has a direction)
 * in bold with a "Best" tag and draws a satin bar where the figures share a scale. Phones scroll
 * the columns sideways under a fixed first column. Share copies this page's link (ids only).
 */
export function CompareView({ table, source }: {
  table: CompareTable;
  /** Areas only: the data the brief reads (Compare › Brief: the one way to a brief). */
  source?: { mode: DataMode; release: string };
}) {
  const shared = useShareLink("anyone with it sees the same comparison");
  const ids = table.columns.map((column) => column.id);
  const brief = useAreasBrief(table, source);
  // This browser's search, read after hydration: the portal links pass on its ceiling and bedrooms.
  const [profile, setProfile] = useState<PreferenceProfile>(DEFAULT_PROFILE);
  useEffect(() => setProfile(loadLocalProfile(DEFAULT_PROFILE)), []);
  // CUJ03 step 2: with a search, its score and the trips to its places, scored as the map does.
  const searching = table.kind === "places" && source !== undefined && !isUnsetProfile(profile) && searchCriteria(profile).length > 0;
  const pack = useSearchPack(searching ? searchKey(profile) : null, source?.mode ?? "demo", source?.release ?? "demo");
  const rows = useMemo(() => withSearchRows(table, searching && pack !== "failed" ? pack : null, profile),
    [table, searching, pack, profile]);
  const tailored = searching ? tailorLine(pageTailor(profile, true)) : "";
  return (
    <>
      {/* CUJ03 board step 2: Saved › Compare. */}
      <Breadcrumbs crumbs={[{ label: "Saved", href: SAVED_HREF }, { label: "Compare", href: null }]} />

      <div className="compare-head">
        <h1>Compare</h1>
        <div className="compare-actions">
          {brief && (
            <a className="area-save-actions__button" href={brief} data-testid="compare-brief">
              <KnitIcon name="note" className="knit-inline" style={{ width: 14, height: 14 }} /> Brief
            </a>
          )}
          <button type="button" className="area-save-actions__button" data-testid="compare-share"
            onClick={() => void shared.share(window.location.href, "A comparison on close knit")}>
            Share
          </button>
          {ids.length < MAX_COMPARE_COLUMNS && (
            <Link className="area-save-actions__button" href={SAVED_HREF} data-testid="compare-add">
              <KnitIcon name="plus" className="knit-inline" style={{ width: 14, height: 14 }} /> Add
            </Link>
          )}
        </div>
      </div>
      <KindTabs kind={table.kind} />
      {tailored && (
        <p className="compare-tailored">
          <Link href="/?layer=personal-match" className="chip-button tailor-chip" data-testid="compare-tailored">
            Tailored to: {tailored} <span aria-hidden="true">✎</span>
          </Link>
        </p>
      )}
      {shared.status}
      <div className="compare-scroll" data-testid="compare-table" data-columns={ids.length}>
        <table className="compare-table">
          <thead>
            <tr>
              <td />
              {table.columns.map((column) => (
                <th key={column.id} scope="col" data-testid="compare-column" data-id={column.id}>
                  <span className="compare-col">
                    {/* The district after " · " drops on a phone so two columns fit (CUJ03 phone board). */}
                    {column.href ? <Link href={column.href} className="compare-col__name" title={column.name}><ColumnName name={column.name} /></Link>
                      : <span className="compare-col__name" title={column.name}><ColumnName name={column.name} /></span>}
                    <small className="compare-col__tag">{column.tag}</small>
                  </span>
                  {ids.length > 2 && (
                    <Link className="compare-col__remove" href={compareHref(table.kind, ids.filter((id) => id !== column.id))}
                      aria-label={`Remove ${column.name}`} data-testid="compare-remove">
                      <KnitIcon name="cross" className="knit-glyph" style={{ width: 12, height: 12 }} />
                    </Link>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} data-testid="compare-row" data-row={row.label}>
                <th scope="row" title={row.note}>{row.label}</th>
                {row.cells.map((cell, index) => (
                  <td key={ids[index]} data-best={cell.best ? "" : undefined} data-bar={cell.bar ?? undefined}>
                    <span className="compare-cell">
                      {cell.best ? <strong>{cell.text}</strong> : <span>{cell.text}</span>}
                      {cell.best && (
                        <span className="compare-best" data-testid="compare-best" title="Best">
                          <KnitIcon name="check" colour="var(--on-primary)" className="knit-glyph" style={{ width: 11, height: 11 }} />
                          <span className="sr-only">Best</span>
                        </span>
                      )}
                    </span>
                    {cell.bar !== null && (
                      <SatinBar value={cell.bar} colour={barColour(cell.best)} width={88} height={10} className="compare-bar" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {table.kind === "places" && (
              // No dead end: each area's page and its homes on the portals (the search's ceiling and bedrooms).
              <tr data-testid="compare-next" className="compare-next">
                <th scope="row">Next</th>
                {table.columns.map((column) => (
                  <td key={column.id}>
                    <span className="compare-next__links">
                      {column.href && <Link className="portal-links__link" href={column.href} data-testid="compare-area-page">Area page<span aria-hidden="true"> →</span></Link>}
                      <AreaPortalLinks outcode={column.outcode ?? titleDistrict(column.name)} profile={profile} from="compare" />
                    </span>
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="compare-empty">No figures to compare for these yet.</p>}
    </>
  );
}
