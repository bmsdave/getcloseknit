"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { GeographyId, PropertyHistory } from "@/lib/contracts";
import { COST_PREFILL_ASSUMPTION, costPrefill, mayBeLeasehold } from "@/lib/area-brief";
import { areaPath } from "@/lib/area-pages";
import { LATEST_BOE_RATES } from "@/lib/boe-latest";
import { formatPounds } from "@/lib/evidence-format";
import { DEFAULT_PROFILE, PROPERTY_HISTORIES, SEARCH_RESULTS } from "@/lib/fixtures";
import type { DataMode } from "@/lib/map-state";
import { loadLocalProfile } from "@/lib/profile-state";
import { sourceLabel } from "@/lib/sourced";
import { askingPrefill, carryPrice, searchBudgetPrefill, soldWords, toolHref, toolPrefill, type ToolPrefill } from "@/lib/tools";
import { directoryFromFixtures, loadUserCandidates } from "@/lib/user-candidates";
import { CostWorksheet } from "./cost-worksheet";
import { useHomeSummary, usePropertyHistory } from "./evidence-panel";
import { KnitIcon } from "./knit/knit-icon";
import { LeaseholdChecklist } from "./leasehold-checklist";
import { PropertyProfileLink } from "./property-profile";
import { ReferencingCheck } from "./referencing-check";
import { UserCandidatesPanel } from "./user-candidates";
import { ViewingChecklistPanel } from "./viewing-checklist";

// Demo candidates link to the preview dossier; real mode searches addresses and reads profiles instead.
const CANDIDATE_DIRECTORY = directoryFromFixtures(SEARCH_RESULTS, PROPERTY_HISTORIES);
const CANDIDATE_HISTORIES: Record<string, PropertyHistory> = Object.fromEntries(
  PROPERTY_HISTORIES.map((history) => [history.uprn, history]),
);
const CANDIDATE_EPC_AREAS: Record<string, number[]> = Object.fromEntries(
  PROPERTY_HISTORIES.map((history) => [history.uprn, [...new Set(
    history.transactions.map((entry) => entry.floorAreaSquareMetres).filter((area): area is number => area !== null),
  )]]),
);

export interface PlanAndCheckProps {
  mode: DataMode;
  /** The area the link came from; null opens the tools with no area. */
  area: { id: GeographyId; name: string } | null;
  /** The chosen home, when the link names one. */
  uprn: string | null;
  /** The chosen home's tenure from its property record (null: unknown). */
  tenure: string | null;
  /** The area's price the cost worksheet starts from and its basis (null: nothing is guessed). */
  prefill: ToolPrefill;
  /** r3 #15 (CUJ02/CUJ09 boards): "← 10 Sample Street", the home this check is for; null when the link names none. */
  back?: { label: string; href: string } | null;
}

/**
 * "Check a home": the home's page and money tools, the housing-cost worksheet
 * started from the linked price, referencing (renters), leasehold diligence
 * (unless the home is known freehold), the agent questions and the candidate
 * list. Moved out of the area card (spec 2026-10 §1); works without an area.
 */
export function PlanAndCheck({ mode, area, uprn, tenure, prefill: linked, back = null }: PlanAndCheckProps) {
  // The search profile lives on this device: read it after hydration so the server render matches.
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  useEffect(() => setProfile(loadLocalProfile(DEFAULT_PROFILE)), []);
  // The home's own last sale prefills its stamp duty and buy-to-let links; the worksheet keeps the area's price.
  const { record: history } = usePropertyHistory(uprn, mode);
  const stock = useHomeSummary(uprn);
  const homePrefill = toolPrefill(history, stock, null);
  // No price in the link, but this home was saved with its asking price: start from that.
  const [saved, setSaved] = useState<ToolPrefill | null>(null);
  useEffect(() => {
    if (linked.price !== null || !uprn) return;
    const found = askingPrefill(loadUserCandidates().store.candidates.find((candidate) => candidate.uprn === uprn));
    setSaved(found);
    // The tabs and a reload carry it too (?price everywhere).
    if (found) carryPrice(found.price);
  }, [linked.price, uprn]);
  // No price and no home: the My match budget (to buy) is the price carried in.
  const budget = uprn ? null : searchBudgetPrefill(profile);
  useEffect(() => {
    if (linked.price === null && budget?.price != null) carryPrice(budget.price);
  }, [linked.price, budget?.price]);
  const prefill = linked.price !== null ? linked : saved ?? budget ?? linked;
  const { price } = prefill;
  const rate = LATEST_BOE_RATES?.value.fixed5 ?? null;
  const deposit = COST_PREFILL_ASSUMPTION.value.depositShare * 100;
  const initial = costPrefill({ market: profile.market, price, rate });
  const prefilled = initial.price !== undefined;
  return (
    <div className="check-home" data-testid="check-home">
      {/* The way back names the home first ("← 10 Sample Street"), then its area. */}
      {(back || area) && (
        <p className="tools-prefill check-home__back" data-testid="check-home-area">
          {back && <Link href={back.href} data-testid="check-home-back"><KnitIcon name="arrow-left" /> {back.label}</Link>}
          {area && (
            <Link href={areaPath({ geographyId: area.id })} data-testid="check-home-area-link">
              {back ? `${area.name.split(" · ")[0]} area` :<><KnitIcon name="arrow-left" /> {area.name}</>}
            </Link>
          )}
        </p>
      )}
      {uprn && (
        <p className="property-tools" data-testid="property-tools">
          {!back && <PropertyProfileLink uprn={uprn} />}
          <Link href={toolHref("stamp-duty", saved ?? homePrefill)}>Stamp duty</Link>
          <Link href={toolHref("investor", saved ?? homePrefill)}>Buy-to-let</Link>
        </p>
      )}
      <section className="methodology-card tools-card">
        <CostWorksheet
          key={`${profile.market}-${price ?? "none"}`}
          profile={profile}
          mode={mode}
          initial={initial}
          note={prefilled && price !== null ? (
            <p className="cost-prefill" data-testid="cost-prefill">
              Started from {prefill.from ?? "the linked price"} ({formatPounds(price)}
              {prefill.sold ? <>, <strong data-testid="cost-prefill-sold">last sale {soldWords(prefill.sold)}</strong></> : null}),
              {" "}a {deposit}% deposit over {COST_PREFILL_ASSUMPTION.value.termYears} years
              {rate !== null && LATEST_BOE_RATES ? (
                <> at the average 5-year fixed rate for a 75% loan-to-value mortgage ({rate}%, {sourceLabel(LATEST_BOE_RATES)})</>
              ) : null}.
              {" "}The deposit and term are an {sourceLabel(COST_PREFILL_ASSUMPTION)}
              {rate !== null && LATEST_BOE_RATES ? <>; a {deposit}% deposit usually pays more than the 75% loan-to-value rate</> : null}.
              Change any figure.
            </p>
          ) : null}
        />
        {profile.market === "rent" && <ReferencingCheck profile={profile} />}
      </section>
      <section className="methodology-card tools-card">
        {mayBeLeasehold(tenure) && (
          <LeaseholdChecklist defaultPrice={profile.market === "buy" ? price ?? profile.targetBudget : null} />
        )}
        <ViewingChecklistPanel
          candidates={area ? [{ id: area.id, name: area.name }] : []}
          profile={profile}
          histories={area && history ? { [history.geographyId]: history } : {}}
        />
      </section>
      <section className="methodology-card tools-card">
        {mode === "real" ? <UserCandidatesPanel directory={[]} histories={{}} epcAreas={{}} search /> : (
          <UserCandidatesPanel directory={CANDIDATE_DIRECTORY} histories={CANDIDATE_HISTORIES} epcAreas={CANDIDATE_EPC_AREAS} />
        )}
      </section>
    </div>
  );
}
