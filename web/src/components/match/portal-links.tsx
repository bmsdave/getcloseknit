"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";

import { areaPath } from "@/lib/area-pages";
import type { AreaBrief } from "@/lib/brief-model";
import type { GeographyId, MatchPack, MatchZone, PreferenceProfile } from "@/lib/contracts";
import {
  extensionInstalled, filterWords, goListingsHref, portalFilter, searchId, titleDistrict, withSearchId, ZONE_PORTAL_LABELS, ZONE_PORTALS,
  type PortalFilter, type PortalLinksResponse, type ZonePortal, type ZonePortalLinks,
} from "@/lib/portal-zones";
import { areaListingLinks } from "@/lib/listing-links";
import { isUnsetProfile } from "@/lib/profile-state";
import { UNSHARED_BUDGET } from "@/lib/saved-shortlists";
import { describeZone } from "@/lib/zones";
import { track } from "@/lib/usage";
import "../../styles/portal-links.css";

type From = "zone" | "match" | "brief" | "compare";

/** The search's zones as portal searches (POST /api/v1/portal-links); null until answered or without zones. */
export function usePortalLinks(profile: PreferenceProfile): PortalLinksResponse | null {
  const zones = profile.zones ?? [];
  const filter = portalFilter(profile);
  const key = JSON.stringify([filter, zones]);
  const [answer, setAnswer] = useState<{ key: string; body: PortalLinksResponse } | null>(null);
  useEffect(() => {
    const [asked, askedZones] = JSON.parse(key) as [PortalFilter, MatchZone[]];
    if (!askedZones.length) return;
    const controller = new AbortController();
    void fetch("/api/v1/portal-links", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...asked, zones: askedZones }),
      signal: controller.signal,
    }).then(async (response) => {
      if (response.ok) setAnswer({ key, body: await response.json() as PortalLinksResponse });
    }).catch(() => undefined);
    return () => controller.abort();
  }, [key]);
  return zones.length && answer?.key === key ? answer.body : null;
}

/** The My match search id when the Close Knit extension is installed (read after hydration), else null. */
export function useExtensionSearchId(profile: PreferenceProfile): string | null {
  const [installed, setInstalled] = useState(false);
  useEffect(() => setInstalled(extensionInstalled()), []);
  return useMemo(() => (installed ? searchId(profile) : null), [installed, profile]);
}

/** One plain-text portal link: a new tab, counted by the page (/go only redirects web clicks). */
export function PortalLink({ href, label, portal, from, filter, kind, shape, outcode, testId }: {
  href: string; label: string; portal: ZonePortal; from: From; filter: PortalFilter;
  kind: "zone" | "listings"; shape?: string; outcode?: string; testId?: string;
}) {
  return (
    <a className="portal-links__link" href={href} target="_blank" rel="noopener" data-testid={testId}
      onClick={() => track("portal_click", { portal, kind, shape, from, market: filter.market, outcode })}>
      {label}<span aria-hidden="true"> ↗</span>
    </a>
  );
}

/** "Rightmove ↗ · Zoopla ↗ · OnTheMarket ↗", the separators quiet. */
function Dotted({ children }: { children: React.ReactNode[] }) {
  return <>{children.map((child, index) => <Fragment key={index}>{index > 0 && <span className="portal-links__dot" aria-hidden="true"> · </span>}{child}</Fragment>)}</>;
}

/** Per portal, the districts covering a zone (or the results): "OnTheMarket SE24 ↗ SW2 ↗ SW9 ↗". */
function DistrictRows({ portals, districts, filter, from, sid }: {
  portals: ZonePortal[]; districts: { outcode: string; links: Partial<Record<ZonePortal, string>> }[];
  filter: PortalFilter; from: From; sid: string | null;
}) {
  if (!portals.length || !districts.length) return null;
  return (
    <ul className="portal-links__districts">
      {portals.map((portal) => (
        <li key={portal}>
          <span className="portal-links__portal">{ZONE_PORTAL_LABELS[portal]}</span>
          {districts.map(({ outcode, links }) => links[portal] && (
            <PortalLink key={outcode} href={withSearchId(links[portal]!, sid)} label={outcode} portal={portal} from={from}
              filter={filter} kind="listings" outcode={outcode} testId={`portal-district-${portal}`} />
          ))}
        </li>
      ))}
    </ul>
  );
}

/** One zone on the portals: "Open on ▸" the portals that take its shape, the districts for the rest. */
export function ZonePortalRow({ zone, filter, from, sid }: { zone: ZonePortalLinks; filter: PortalFilter; from: From; sid: string | null }) {
  const direct = zone.portals.filter((entry) => entry.href);
  const rest = zone.portals.filter((entry) => !entry.href).map((entry) => entry.portal);
  return (
    <div className="portal-links__zone" data-testid="zone-portal-row">
      {direct.length > 0 && (
        <p className="portal-links__row">
          <span className="portal-links__lead">Open on ▸</span>{" "}
          <Dotted>{direct.map((entry) => (
            <PortalLink key={entry.portal} href={withSearchId(entry.href!, sid)} label={entry.label} portal={entry.portal} from={from}
              filter={filter} kind="zone" shape={zone.kind === "borough" && entry.portal === "rightmove" ? "borough" : "draw"}
              testId={`zone-portal-${entry.portal}`} />
          ))}</Dotted>
        </p>
      )}
      {zone.districts.length > 0 && rest.length > 0 && (
        <>
          {direct.length === 0 && <p className="portal-links__lead">Open on · postcode districts that cover this zone</p>}
          <DistrictRows portals={rest} districts={zone.districts} filter={filter} from={from} sid={sid} />
        </>
      )}
      {direct.length === 0 && zone.districts.length === 0 && <p className="portal-links__note">No portal search for this one yet.</p>}
    </div>
  );
}

function FilterNote({ filter }: { filter: PortalFilter }) {
  return <p className="portal-links__note">{filterWords(filter)} passed on · opens in a new tab</p>;
}

/**
 * On the zone chips: each zone of the search as a chip; tapping it opens its "Open on ▸" row.
 * Lives in Your search until the Where card takes the chips.
 */
export function ZonePortalChips({ profile }: { profile: PreferenceProfile }) {
  const zones = profile.zones ?? [];
  const answer = usePortalLinks(profile);
  const sid = useExtensionSearchId(profile);
  const [open, setOpen] = useState<number | null>(null);
  if (!zones.length) return null;
  const filter = portalFilter(profile);
  const chosen = open !== null && open < zones.length ? open : null;
  return (
    <div className="portal-links portal-links--chips" data-testid="zone-portal-chips">
      <ul className="search-chips">
        {zones.map((zone: MatchZone, index) => (
          <li key={`${index}-${describeZone(zone)}`}>
            <button type="button" className="search-chip" aria-expanded={chosen === index} data-testid="zone-chip"
              onClick={() => setOpen(chosen === index ? null : index)}>
              {describeZone(zone)} <span aria-hidden="true">▸</span>
            </button>
          </li>
        ))}
      </ul>
      {chosen !== null && (answer?.zones[chosen] ? (
        <>
          <ZonePortalRow zone={answer.zones[chosen]} filter={filter} from="zone" sid={sid} />
          <FilterNote filter={filter} />
        </>
      ) : <p className="portal-links__note" role="status">Finding portal searches…</p>)}
    </div>
  );
}

/**
 * Up to 3 postcode districts of the top results: the search brief's areas first (the list's
 * page of ten, selected area first, each with its busiest district), then the districts in the result titles.
 */
export function resultDistricts(pack: MatchPack, brief: AreaBrief | null = null, limit = 3): string[] {
  const found: string[] = [];
  const add = (district: string | null | undefined) => {
    const code = district ? titleDistrict(district) : null;
    if (code && !found.includes(code) && found.length < limit) found.push(code);
  };
  const included = new Set<string>(pack.values.filter((result) => !result.excluded).map((result) => result.geographyId));
  for (const area of brief?.areas ?? []) if (included.has(area.geographyId)) add(area.outcodes[0]);
  for (const result of pack.values) if (!result.excluded) add(result.title ?? result.name);
  return found;
}

/**
 * On the My match result, under the top 10: "Homes for sale in these areas". With zones, each
 * zone opens as itself on the portals; without, the top results' postcode districts (up to 3).
 */
export function HomesInTheseAreas({ pack, profile, brief = null }: { pack: MatchPack; profile: PreferenceProfile; brief?: AreaBrief | null }) {
  const zones = profile.zones ?? [];
  const answer = usePortalLinks(profile);
  const sid = useExtensionSearchId(profile);
  const filter = portalFilter(profile);
  const districts = resultDistricts(pack, brief);
  // The untouched example search has no budget of the household's own to pass on.
  if (isUnsetProfile(profile)) return null;
  const heading = filter.market === "rent" ? "Homes to rent in these areas" : "Homes for sale in these areas";
  return (
    <section className="portal-links portal-links--result" data-testid="homes-in-these-areas" aria-label={heading}>
      <h3 className="portal-links__title">{heading}</h3>
      {zones.length > 0 ? (answer ? answer.zones.map((zone, index) => (
        <div key={index} className="portal-links__named">
          {answer.zones.length > 1 && <p className="portal-links__zone-name">{zone.label}</p>}
          <ZonePortalRow zone={zone} filter={filter} from="match" sid={sid} />
        </div>
      )) : <p className="portal-links__note" role="status">Finding portal searches…</p>) : districts.length === 0 ? (
        // The block keeps its place while the areas' districts load, so nothing below it jumps.
        <p className="portal-links__note portal-links__pending" role="status">Finding postcode districts…</p>
      ) : (
        <DistrictRows portals={ZONE_PORTALS} filter={filter} from="match" sid={sid}
          districts={districts.map((outcode) => ({
            outcode, links: Object.fromEntries(ZONE_PORTALS.map((portal) => [portal, goListingsHref(portal, outcode, filter)])) as Record<ZonePortal, string>,
          }))} />
      )}
      <FilterNote filter={filter} />
    </section>
  );
}

/**
 * The brief ends on a next step per area: its page, and its homes on the portals (the
 * area's postcode district, with the search's ceiling and bedrooms). No dead end.
 */
export function BriefNextSteps({ areas, profile }: {
  areas: { geographyId: GeographyId; name: string; outcode: string | null }[]; profile: PreferenceProfile;
}) {
  if (!areas.length) return null;
  const words = profile.market === "rent" ? "Homes to rent" : "Homes for sale";
  return (
    <section className="portal-links brief-next" data-testid="brief-next-steps" aria-labelledby="brief-next-title">
      <h4 id="brief-next-title" className="portal-links__title">Next step</h4>
      <ul className="brief-next__areas">
        {areas.map((area) => (
          <li key={area.geographyId} data-testid="brief-next-area">
            <strong>{area.name}</strong>
            <span className="brief-next__links">
              <Link className="portal-links__link" href={areaPath({ geographyId: area.geographyId })} data-testid="brief-area-page">
                Area page<span aria-hidden="true"> →</span>
              </Link>
              {area.outcode && (
                <>
                  <span className="portal-links__dot" aria-hidden="true"> · </span>
                  <span className="portal-links__lead">{words}:</span>
                  <AreaPortalLinks outcode={area.outcode} profile={profile} from="brief" />
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      {openSearch(profile) ? <p className="portal-links__note">Any price · opens in a new tab</p> : <FilterNote filter={portalFilter(profile)} />}
    </section>
  );
}

/**
 * No budget to pass on: no search of the household's own yet, or a shared brief without its budget.
 * The portals then open on the district with no ceiling (and the bedrooms, if known).
 */
function openSearch(profile: PreferenceProfile): boolean {
  return isUnsetProfile(profile) || profile.maximumBudget >= UNSHARED_BUDGET;
}

/** One area's homes for sale (its postcode district) as plain links, for Brief and Compare. */
export function AreaPortalLinks({ outcode, profile, from }: { outcode: string | null; profile: PreferenceProfile; from: From }) {
  const filter = portalFilter(profile);
  const sid = useExtensionSearchId(profile);
  if (!outcode) return null;
  const open = openSearch(profile);
  const links = open
    ? areaListingLinks(outcode, { market: profile.market, maxPrice: null, minBedrooms: isUnsetProfile(profile) ? null : profile.bedrooms })
      .filter((entry): entry is { portal: ZonePortal; label: string; href: string } => entry.portal !== "openrent")
      .map(({ portal, href }) => ({ portal, href: href as string | null }))
    : ZONE_PORTALS.map((portal) => ({ portal, href: goListingsHref(portal, outcode, filter) }));
  if (!links.length || links.some((entry) => entry.href === null)) return null;
  return (
    <span className="portal-links__inline" data-testid="area-portal-links">
      <Dotted>{links.map(({ portal, href }) => (
        <PortalLink key={portal} href={open ? href! : withSearchId(href!, sid)} label={ZONE_PORTAL_LABELS[portal]} portal={portal} from={from}
          filter={filter} kind="listings" outcode={outcode.toUpperCase()} testId={`area-portal-${portal}`} />
      ))}</Dotted>
    </span>
  );
}
