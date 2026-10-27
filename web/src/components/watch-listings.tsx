"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { assistantUrl } from "@/lib/discuss";
import { DEFAULT_PROFILE } from "@/lib/fixtures";
import { closeMapSheet, openMapSheet } from "@/lib/map-sheets";
import { areaListingLinks } from "@/lib/listing-links";
import { normalisePostcode } from "@/lib/postcode-page";
import { goListingsHref, titleDistrict, ZONE_PORTAL_LABELS, ZONE_PORTALS, type ZonePortal } from "@/lib/portal-zones";
import { isUnsetProfile, loadLocalProfile } from "@/lib/profile-state";
import { pagePath, track } from "@/lib/usage";

import { CopyField } from "./copy-field";
import { MoneyInput } from "./money-input";
import { MapSheet, useOpenMapSheet } from "./map-sheet";

/**
 * Review #30, phase 1: "Watch new listings" on the web. Close Knit keeps no
 * listings and no e-mail addresses. The watch works without an
 * agent first: the portals' own alerts, their searches opened with the area,
 * price and beds filled in (the /go links); saving the search there sends
 * their emails. The prompt for the reader's own agent stays as the second way
 * (Open in Claude or ChatGPT with it filled in, or copied; CUJ12 v4).
 * Nothing is stored or sent.
 */
export function watchPrompt(place: string, filter: WatchFilter | null = null): string {
  const market = filter?.market === "rent" ? "to rent" : "for sale";
  const price = filter?.maxPrice ? `up to £${filter.maxPrice.toLocaleString("en-GB")}${filter.market === "rent" ? " a month" : ""}` : null;
  const beds = filter?.minBedrooms ? `${filter.minBedrooms}+ beds` : null;
  const terms = [price, beds].filter(Boolean).join(", ");
  return `Using Close Knit, watch for new homes ${market} in ${place}${terms ? `, ${terms}` : ""}. Once a week, open the property portals' own searches for ${place}, `
    + "tell me what is new since last time, and check each asking price against recorded sales nearby. Keep my budget and preferences out of anything you save.";
}

/** The postcode district a watch's place names: a postcode's outward code, or the district at the end of an area title. */
export function watchDistrict(place: string): string | null {
  const postcode = normalisePostcode(place);
  return postcode ? postcode.split(" ")[0] : titleDistrict(place);
}

export interface WatchFilter { market: "buy" | "rent"; maxPrice: number | null; minBedrooms: number | null }

/** The search the dialog opens with: the household's own My match search when there is one, else any price and beds. */
export function watchStart(): WatchFilter {
  const profile = loadLocalProfile(DEFAULT_PROFILE);
  if (isUnsetProfile(profile)) return { market: "buy", maxPrice: null, minBedrooms: null };
  return { market: profile.market, maxPrice: Math.round(profile.maximumBudget), minBedrooms: Math.max(0, Math.min(10, profile.bedrooms)) };
}

/** One link per portal for the district: through /go with a price (counted), else the open search. */
export function watchLinks(outcode: string, filter: WatchFilter): { portal: ZonePortal; href: string }[] {
  const price = filter.maxPrice !== null && filter.maxPrice >= 100 && filter.maxPrice <= 100_000_000 ? filter.maxPrice : null;
  if (price !== null) {
    const go = { market: filter.market, maxPrice: price, minBedrooms: filter.minBedrooms ?? 0 };
    return ZONE_PORTALS.flatMap((portal) => {
      const href = goListingsHref(portal, outcode, go);
      return href ? [{ portal, href }] : [];
    });
  }
  return areaListingLinks(outcode, { market: filter.market, maxPrice: null, minBedrooms: filter.minBedrooms })
    .filter((entry): entry is { portal: ZonePortal; label: string; href: string } => entry.portal !== "openrent")
    .map(({ portal, href }) => ({ portal, href }));
}

const BEDS: { value: number | null; label: string }[] = [
  { value: null, label: "Any" }, { value: 0, label: "Studio+" }, { value: 1, label: "1+" }, { value: 2, label: "2+" },
  { value: 3, label: "3+" }, { value: 4, label: "4+" }, { value: 5, label: "5+" },
];

export function WatchListings({ place, label = "Watch new listings", className = "chip-button" }: {
  /** The area or postcode the watch names ("St James's · SW1A", "SW1A 1AB"). */
  place: string;
  label?: ReactNode;
  /** The trigger's look: a quiet chip by default. */
  className?: string;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  // One sheet at a time (lib/map-sheets.ts): each Watch button owns its own id, so only its sheet opens.
  const id = `watch:${useId()}`;
  const open = useOpenMapSheet() === id;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const close = () => {
    closeMapSheet(id);
    trigger.current?.focus();
  };
  return (
    <>
      <button ref={trigger} type="button" className={className} aria-haspopup="dialog" aria-expanded={open}
        data-testid="watch-listings-open" onClick={() => { openMapSheet(id); track("watch_open", { from: pagePath(window.location.pathname) }); }}>
        {label}
      </button>
      {/* CUJ12 v4: the shared MapSheet (handle, snaps, ✕, Esc, back gesture), never a centred modal. */}
      {open && mounted && createPortal(
        <MapSheet id={id} title="Watch new homes" onClose={close} className="watch-sheet" testId="watch-listings-dialog"
          closeTestId="watch-listings-close">
          <WatchBody place={place} />
        </MapSheet>,
        document.body,
      )}
    </>
  );
}

/** The sheet's content: where, the portals' own alerts, then the same search for an AI agent. */
function WatchBody({ place }: { place: string }) {
  // Read once on open (the sheet mounts then): the household's own search, never sent anywhere.
  const [filter, setFilter] = useState<WatchFilter>(watchStart);
  const prompt = watchPrompt(place, filter);
  return (
    <div className="watch-sheet__body">
      <p className="watch-sheet__where"><span>Where</span> <strong className="watch-dialog__place" data-testid="watch-place">{place}</strong></p>
      <PortalAlerts place={place} filter={filter} onFilter={setFilter} />
      <section className="watch-agent" aria-label="With your AI agent">
        <h3 className="watch-dialog__lead">Or with your AI agent</h3>
        <p className="watch-agent__links">
          <a href={assistantUrl("claude", prompt)} target="_blank" rel="noopener" data-testid="watch-open-claude">Open in Claude<span aria-hidden="true"> ↗</span></a>
          <a href={assistantUrl("chatgpt", prompt)} target="_blank" rel="noopener" data-testid="watch-open-chatgpt">ChatGPT<span aria-hidden="true"> ↗</span></a>
          <Link href="/agents" data-testid="watch-listings-claude">Any agent <span aria-hidden="true">→</span></Link>
        </p>
        <CopyField value={prompt} label="the watch prompt" testId="watch-listings-prompt" />
        <p className="watch-agent__note">Nothing is stored or sent by Close Knit.</p>
      </section>
    </div>
  );
}

/** The portals' own alerts for the place's district, with the search's market, price and beds. */
function PortalAlerts({ place, filter, onFilter }: { place: string; filter: WatchFilter; onFilter: (filter: WatchFilter) => void }) {
  const outcode = watchDistrict(place);
  const priceId = useId();
  const bedsId = useId();
  if (!outcode) return null;
  const links = watchLinks(outcode, filter);
  const set = (change: Partial<WatchFilter>) => onFilter({ ...filter, ...change });
  return (
    <section className="watch-alert" data-testid="watch-portal-alerts" aria-label="Alerts on the portals">
      <h3 className="watch-dialog__lead">Alerts on the portals</h3>
      <div className="watch-alert__fields">
        <div className="watch-alert__market" role="group" aria-label="For">
          {(["buy", "rent"] as const).map((market) => (
            <button key={market} type="button" className="chip-button" aria-pressed={filter.market === market}
              data-testid={`watch-market-${market}`} onClick={() => set({ market })}>
              {market === "buy" ? "Buy" : "Rent"}
            </button>
          ))}
        </div>
        <label htmlFor={priceId}>{filter.market === "rent" ? "Up to (£ a month)" : "Up to (£)"}
          <MoneyInput id={priceId} className="knit-field" value={filter.maxPrice} placeholder="Any price"
            onValue={(maxPrice) => set({ maxPrice })} data-testid="watch-max-price" />
        </label>
        <label htmlFor={bedsId}>Beds
          <select id={bedsId} className="knit-field" value={filter.minBedrooms ?? ""} data-testid="watch-beds"
            onChange={(event) => set({ minBedrooms: event.target.value === "" ? null : Number(event.target.value) })}>
            {BEDS.map((option) => <option key={option.label} value={option.value ?? ""}>{option.label}</option>)}
          </select>
        </label>
      </div>
      <p className="watch-alert__links">
        <span>Open {outcode} on ▸</span>{" "}
        {links.map(({ portal, href }, index) => (
          <span key={portal}>
            {index > 0 && <span aria-hidden="true"> · </span>}
            <a href={href} target="_blank" rel="noopener" data-testid={`watch-portal-${portal}`}
              onClick={() => track("portal_click", { portal, kind: "listings", from: "watch", market: filter.market, outcode })}>
              {ZONE_PORTAL_LABELS[portal]}<span aria-hidden="true"> ↗</span>
            </a>
          </span>
        ))}
      </p>
      <p className="watch-alert__note">Save the search there to get its emails. Opens in a new tab.</p>
    </section>
  );
}
