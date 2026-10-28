"use client";

import Link from "next/link";

import type { GeographyId, MatchPack, PreferenceProfile } from "@/lib/contracts";
import type { DataMode, MatchList as MatchListName } from "@/lib/map-state";
import { applyComparisonAdopt } from "@/lib/area-comparison";
import { compareHref } from "@/lib/compare-table";
import { removeCompared, showComparedOnly, toggleCompared, useComparedAreas, writeCompared } from "@/lib/compare-selection";
import { encodeSearchLink, isUnsetProfile, profileOrigin, sensitiveFieldPreview, sharedCompared } from "@/lib/profile-state";
import { friendlyName, namedPack } from "@/lib/match-brief";
import { budgetMoney, itemChip } from "@/lib/match-words";
import { londonWord } from "@/lib/coverage-words";
import { useScope } from "@/components/scope-context";
import { coversEngland } from "@/lib/scope";
import { freshSearch, searchItems } from "@/lib/match-search";
import { RENT_INDEX_LABEL } from "@/lib/fixtures";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { DecisionBriefPanel } from "./decision-brief";
import { SimilarAreasSection } from "./similar-areas";
import { useSaved } from "@/lib/saved-items";
import { useMatchExtras } from "@/lib/match-extras";
import { ShortlistPanel } from "./shortlists";
import { KnitIcon } from "./knit/knit-icon";
import { HomesInTheseAreas } from "./match/portal-links";
import { useShareLink } from "./match/share-link";
import { MyCriteria } from "./match/my-criteria";
import { CriterionFocus } from "./match/criterion-focus";
import { MatchFoot, MatchList } from "./match/match-list";
import { MatchResults } from "./match/match-results";
import { MatchMore } from "./match/match-more";
import type { FindLike } from "./match/use-find-like";
import "../styles/match-panel.css";
import "../styles/match-criteria.css";
import "../styles/match-list.css";
import type { CustomCriterion } from "@/lib/custom-criteria";
import { BRIEF_LAYER_LABEL, BRIEF_LAYERS, homeLabel, type AreaBrief, type BriefLayer, type SchoolFilter } from "@/lib/brief-model";
import { MATCH_BUSY_WORDS, type MatchBusy } from "@/lib/match-retry";

interface PersonalMatchPanelProps {
  /** The match as shown: the API's, re-scored on the client while the search on screen is newer (null before the first). */
  pack: MatchPack | null;
  jobStatus: string | null;
  /** The API refused the search (429 or 5xx): retrying, or Try again (lib/match-retry.ts). */
  busy?: { state: MatchBusy; onRetry: () => void };
  profile: PreferenceProfile;
  selected: GeographyId | null;
  mode: DataMode;
  release: string;
  onSelect: (id: GeographyId) => void;
  /** Every edit of the search (the list, cards, marks); the ranking re-scores at once and refetches. */
  onChangeProfile?: (profile: PreferenceProfile) => void;
  brief?: AreaBrief | null;
  schoolFilter?: SchoolFilter;
  onSchoolFilter?: (filter: SchoolFilter) => void;
  placing?: boolean;
  onPlacing?: (placing: boolean) => void;
  /** My criteria: the custom criterion painted on the map, and showing one (null: back to My match). */
  shownCriterion?: CustomCriterion | null;
  onShowCriterion?: (criterion: CustomCriterion | null) => void;
  /** The comparison panel's back link when it came from another layer (see CriterionFocus). */
  criterionBack?: { label: string; go: () => void } | null;
  /** The phone sheet's header carries the comparison's "← Back": CriterionFocus leaves its own out. */
  criterionBackInHeader?: boolean;
  /** The picked area's key numbers while a criterion is shown (the brief's tiles, see AreaKeyNumbers). */
  keyNumbers?: ReactNode;
  /** Corners of a zone being drawn on the map (null when not drawing). */
  drawing?: [number, number][] | null;
  onDrawing?: (draft: [number, number][] | null) => void;
  /** While a handle is dragged: the search as it would be, for the live map and count (null when let go). */
  onDraft?: (profile: PreferenceProfile | null) => void;
  /** The layer on the map before My match: "Any layer…" offers it first. */
  mapLayer?: string | null;
  /** Flagged layers the release leaves out (FLAGS.md): no chip or Any layer item for them. */
  hiddenLayers?: readonly string[];
  /** The row under the pointer, highlighted on the map. */
  onHover?: (id: GeographyId | null) => void;
  /** Top 10 | Bottom 10 (MapState.matchList): the map pins the same ten. */
  matchList?: MatchListName;
  onMatchList?: (list: MatchListName) => void;
  /** "Like this" / a tool's budget: the budget to start from. */
  like?: FindLike | null;
  /** "Top 10 ›" on a phone: the sheet rises to full height. */
  onShowTop?: () => void;
  /** What the map draws with the results (prices, neighbours, schools, travel). */
  layers?: Record<BriefLayer, boolean>;
  onLayers?: (layers: Record<BriefLayer, boolean>) => void;
}

/**
 * My match: the search is the list (no wizard), the ranking right under it. The selected
 * area's card opens above the ten; "Compare places" (the household's own A-vs-B criteria) and "Saved areas & costs"
 * wait behind one button each. Nothing asked yet: the three start rows, Budget focused.
 */
export function PersonalMatchPanel(props: PersonalMatchPanelProps) {
  const [sharing, setSharing] = useState(false);
  const shared = useShareLink("anyone with it sees your budget and place", { toast: true });
  // Opened from someone's link (or the example) and not edited yet: this search, not "yours".
  const origin = profileOrigin(props.profile);
  const fromLink = origin === "shared";
  const unset = isUnsetProfile(props.profile);
  // Ticked areas live in the compare store: a reload, the area page and this panel share them.
  const compared = useComparedAreas();
  // A shared link's compared areas arrive ticked: shown here, stored only once the recipient changes them.
  useEffect(() => {
    if (!fromLink) return;
    const ids = sharedCompared(window.location.hash);
    if (ids.length) showComparedOnly(ids);
  }, [fromLink, props.profile]);
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  // The older blocks under the ten wait behind a default-off flag (lib/match-extras.ts).
  const extras = useMatchExtras();
  // G24: saved areas show here with or without a ranked search.
  const savedAreas = useSaved().areas.length > 0;
  // UX-47: invalid selection actions are explained visibly and never evict
  // an existing selection; any successful change clears the explanation.
  const [boundsNotice, setBoundsNotice] = useState<string | null>(null);
  // Nothing asked yet: the list starts empty (the three start rows), never the untouched default's budget.
  const listProfile = useMemo(() => (unset ? freshSearch(props.profile) : props.profile), [unset, props.profile]);
  const items = useMemo(() => searchItems(listProfile), [listProfile]);
  // Named in words people use ("Lamorbey · DA15", never "Bexley 022A").
  const display = useMemo(() => (props.pack && !unset && items.length ? namedPack(props.pack) : null), [props.pack, unset, items.length]);
  const selected = display?.values.find((result) => result.geographyId === props.selected) ?? null;
  const visibleCompared = compared.filter((id) => display?.values.some((result) => result.geographyId === id) ?? false);
  const results = useRef<HTMLDivElement>(null);
  const [ownList, setOwnList] = useState<MatchListName>("top");
  const list = props.matchList ?? ownList;
  const setList = props.onMatchList ?? setOwnList;
  function areaName(id: GeographyId) {
    const result = display?.values.find((entry) => entry.geographyId === id);
    return result ? friendlyName(result) : "this area";
  }
  function toggleArea(id: GeographyId) {
    const next = toggleCompared(id);
    setBoundsNotice(next.refused
      ? `Comparison holds four areas — remove one to add ${areaName(next.refused)}.`
      : null);
  }
  function removeArea(id: GeographyId) {
    removeCompared(id);
    setBoundsNotice(null);
  }
  function clearCompared() {
    writeCompared([]);
    setBoundsNotice(null);
  }
  function adoptCandidates(ids: GeographyId[]) {
    const next = applyComparisonAdopt(ids);
    writeCompared(next.ids);
    setBoundsNotice(next.truncated > 0
      ? `Comparison holds four areas — kept the first four of ${ids.length} saved areas.`
      : null);
  }
  const change = props.onChangeProfile ?? (() => undefined);
  // A shared or example search becomes the household's own: a copy, saved from now on.
  const makeMine = () => change(structuredClone(props.profile));
  const showTop = () => {
    props.onShowTop?.();
    requestAnimationFrame(() => results.current?.scrollIntoView?.({ block: "start", behavior: "smooth" }));
  };
  const editor = (
    <MatchList profile={listProfile} onChange={change} pack={display} mode={props.mode} release={props.release}
      mapLayer={props.mapLayer ?? null} hiddenLayers={props.hiddenLayers ?? []} onDraft={props.onDraft ?? (() => undefined)} drawing={props.drawing ?? null}
      onDrawing={props.onDrawing ?? (() => undefined)} onShowTop={showTop} onShare={() => setSharing(true)} like={props.like ?? null}
      placing={props.placing} onPlacing={props.onPlacing} />
  );
  const resultsNode = (
    <div ref={results} className="match-results-anchor">
      {display && (
        <MatchResults pack={display} items={items} profile={props.profile} selected={props.selected} onSelect={props.onSelect}
          onHover={props.onHover} list={list} onList={setList} compared={visibleCompared} onToggleCompare={toggleArea}
          mode={props.mode} release={props.release} />
      )}
    </div>
  );
  // A criterion of the household's own on the map: the panel reads that criterion instead of the match.
  if (props.shownCriterion && props.onChangeProfile && props.onShowCriterion) {
    return (
      <aside className="evidence-panel match-panel" data-testid="match-ranking" aria-live="polite">
        <CriterionFocus key={props.shownCriterion.id} criterion={props.shownCriterion} profile={props.profile}
          onChange={props.onChangeProfile} onShow={props.onShowCriterion} onSelect={props.onSelect} back={props.criterionBack} backInHeader={props.criterionBackInHeader}
          selected={props.selected} selectedName={selected ? selected.name : null} keyNumbers={props.keyNumbers} />
      </aside>
    );
  }
  return (
    <aside className="evidence-panel match-panel" data-testid="match-ranking">
      <h2 className={`match-panel-title${origin === "own" ? " match-panel-title--own" : ""}`}>{origin === "own" ? "My match" : "This search"}</h2>
      {fromLink && <SharedCard profile={props.profile} onEdit={makeMine} />}
      {origin === "example" && (
        <section className="match-origin-banner" data-testid="example-banner" aria-label="Example search">
          <p><strong>Example search</strong></p>
          <div className="match-origin-actions">
            <button type="button" onClick={makeMine}>Make it mine</button>
          </div>
        </section>
      )}
      {unset && compared.length > 0 && (
        <p className="metric-description" data-testid="compare-waiting">
          {compared.length} {compared.length === 1 ? "area" : "areas"} to compare: add your budget.
        </p>
      )}
      {props.profile.market === "rent" && !unset && (
        <p className="metric-description" data-testid="rent-index-label">Rent index: {RENT_INDEX_LABEL}.</p>
      )}
      {/* Chips in priority order, then the count and the top 10, for a shared search too (CUJ08 step
          2): the editor never moves in the tree, so the first edit of a shared search keeps the card being dragged open. */}
      {editor}
      {sharing && (
        <SharePreview
          profile={props.profile}
          compared={visibleCompared.map(areaName)}
          onConfirm={() => { setSharing(false); void shared.share(shareProfileUrl(props.profile, visibleCompared), `A ${londonWord()}home search`); }}
          onCancel={() => setSharing(false)}
        />
      )}
      {shared.status}
      {props.jobStatus && <p className="route-job-status" role="status">{props.jobStatus}</p>}
      {props.busy?.state && (
        <p className="route-job-status" role="status" data-testid="match-busy">
          {MATCH_BUSY_WORDS[props.busy.state]}
          {props.busy.state === "failed" && <>{" "}<button type="button" className="text-button" onClick={props.busy.onRetry}>Try again</button></>}
        </p>
      )}
      {resultsNode}
      {/* Under the top 10, the matching areas (or the search's zones) on the portals. */}
      {display && list === "top" && <HomesInTheseAreas pack={display} profile={props.profile} brief={props.brief ?? null} />}
      {extras && <div className="match-more">
        {display && props.layers && props.onLayers && (
          <div className="brief-layers" role="group" aria-label="Show on the map" data-testid="brief-layers">
            <h3>Show on the map</h3>
            {BRIEF_LAYERS.map((layer) => (
              <button key={layer} type="button" aria-pressed={props.layers![layer]} onClick={() => props.onLayers!({ ...props.layers!, [layer]: !props.layers![layer] })}>
                {BRIEF_LAYER_LABEL[layer]}
              </button>
            ))}
          </div>
        )}
        {props.onChangeProfile && <MatchMore profile={listProfile} onChange={change} mode={props.mode} />}
        {props.onChangeProfile && props.onShowCriterion && (
          <>
            <button type="button" className="match-more-toggle" aria-expanded={criteriaOpen} data-testid="compare-places"
              onClick={() => setCriteriaOpen(!criteriaOpen)}>Compare places</button>
            {criteriaOpen && (
              <MyCriteria profile={props.profile} onChange={props.onChangeProfile} shown={props.shownCriterion ?? null}
                onShow={props.onShowCriterion} />
            )}
          </>
        )}
        {(display || savedAreas) && (
          <details className="match-saved" data-testid="saved-areas-costs">
            <summary>Saved areas &amp; costs</summary>
            <ShortlistPanel
              pack={display}
              profile={props.profile}
              mode={props.mode}
              release={props.release}
              compared={visibleCompared}
              onAdoptCandidates={adoptCandidates}
            />
            {display && (
              <DecisionBriefPanel pack={display} profile={props.profile} compared={visibleCompared} mode={props.mode}
                brief={props.brief ?? null} />
            )}
          </details>
        )}
      </div>}
      <MatchFoot profile={listProfile} onChange={change} onShare={() => setSharing(true)} empty={items.length === 0} extras={extras} />
      {/* Any chosen area, ranked or not: the areas with similar figures (browsable; "Like this" is the search). */}
      {props.selected && (
        <SimilarAreasSection
          key={props.selected}
          geographyId={props.selected}
          zones={props.profile.zones}
          onSelect={props.onSelect}
        />
      )}
      {display && (
        <ComparisonTray
          entries={display.values.map((result) => ({ id: result.geographyId, name: result.name }))}
          compared={visibleCompared}
          notice={boundsNotice}
          stage={visibleCompared.length >= 2 ? "compare" : "shortlist"}
          stages={extras}
          onRemove={removeArea}
          onClear={clearCompared}
        />
      )}
    </aside>
  );
}

type TrayStage = "shortlist" | "compare" | "brief";
const TRAY_STAGES: { id: TrayStage; label: string }[] = [
  { id: "shortlist", label: "Shortlist" }, { id: "compare", label: "Compare" }, { id: "brief", label: "Brief" },
];

/**
 * #10: once an area is ticked, a tray sticks to the bottom of the results: where you are (Needs ✓ ·
 * Shortlist · Compare · Brief), how many areas and Compare (two or more), the one primary on
 * screen. Compare opens /compare (no dialog here), whose Brief is the one way to a brief.
 * The names (each removable) and Clear wait behind the count. Idle, it stays for screen readers but
 * takes no room. Its height goes to the scroller as --tray-h.
 */
function ComparisonTray({ entries, compared, notice, stage, stages, onRemove, onClear }: {
  entries: Array<{ id: GeographyId; name: string }>;
  compared: GeographyId[];
  notice: string | null;
  stage: TrayStage;
  /** The Needs · Shortlist · Compare · Brief steps (My match's older extras, default off). */
  stages: boolean;
  onRemove: (id: GeographyId) => void;
  onClear: () => void;
}) {
  const tray = useRef<HTMLElement>(null);
  const selected = entries.filter((entry) => compared.includes(entry.id));
  const idle = selected.length === 0 && !notice;
  useTrayHeight(tray, !idle);
  const count = selected.length;
  return (
    <section ref={tray} className={`comparison-tray comparison-tray--dock${idle ? " comparison-tray--idle" : ""}`}
      data-testid="comparison-tray" aria-label="Comparison tray">
      {stages && (
        <ol className="tray-stages" aria-label="Your progress">
          <li className="tray-stage tray-stage--done">Needs <KnitIcon name="check" colour="currentColor" className="knit-inline" style={{ width: 11, height: 11 }} /><span className="sr-only"> (done)</span></li>
          {TRAY_STAGES.map((item) => (
            <li key={item.id} className="tray-stage" aria-current={item.id === stage ? "step" : undefined}>{item.label}</li>
          ))}
        </ol>
      )}
      {notice && (
        <p className="comparison-tray__notice" data-testid="comparison-notice" role="status">{notice}</p>
      )}
      <div className="comparison-tray__actions">
        <details className="tray-areas">
          <summary>
            <span className="comparison-tray__count">{count}<span className="tray-areas__word"> {count === 1 ? "area" : "areas"}</span></span>
            <span className="sr-only"> · {count} of 4 selected</span>
          </summary>
          <div className="tray-areas__body">
            <ul className="comparison-tray__chips">
              {selected.map((entry) => (
                <li key={entry.id} data-testid="comparison-chip" className="comparison-tray__chip">
                  {entry.name}
                  <button type="button" aria-label={`Remove ${entry.name} from comparison`} onClick={() => onRemove(entry.id)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="tray-clear" onClick={onClear} disabled={count === 0}>Clear</button>
          </div>
        </details>
        {count >= 2
          ? <Link className="primary-action tray-compare" href={compareHref("places", selected.map((entry) => entry.id))} aria-label="Compare areas"
            data-testid="tray-compare">Compare</Link>
          : <button type="button" className="primary-action tray-compare" aria-label="Compare areas" disabled>Compare</button>}
      </div>
      {count < 2 && <p className="comparison-tray__hint">Select at least two areas to compare.</p>}
    </section>
  );
}

/** The tray's height on the scrolling panel as --tray-h, kept current while it changes size. */
function useTrayHeight(tray: RefObject<HTMLElement | null>, shown: boolean) {
  useEffect(() => {
    const node = tray.current;
    const scroller = node ? scrollParent(node) : null;
    if (!node || !scroller) return;
    const apply = () => scroller.style.setProperty("--tray-h", shown ? `${Math.ceil(node.getBoundingClientRect().height)}px` : "0px");
    apply();
    // Anything scrolled or tabbed into view stops above the tray, never under it.
    scroller.style.scrollPaddingBottom = "calc(var(--tray-h, 0px) + 8px)";
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    observer?.observe(node);
    return () => {
      observer?.disconnect();
      scroller.style.removeProperty("--tray-h");
      scroller.style.removeProperty("scroll-padding-bottom");
    };
  }, [tray, shown]);
}

function scrollParent(node: HTMLElement): HTMLElement | null {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    // A phone's My match sheet scrolls its body once it is full (MapSheet): that body is the scroller.
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) || parent.classList.contains("map-sheet__body")) return parent;
  }
  return null;
}

function SharePreview({ profile, compared, onConfirm, onCancel }: {
  profile: PreferenceProfile; compared: string[]; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="share-preview" data-testid="share-preview" role="dialog" aria-label="Review before sharing">
      <h2>Review before sharing</h2>
      <p>
        Anyone with this link sees these private details{compared.length ? " and the areas you are comparing" : ""}.
        Nothing is shared until you confirm.
      </p>
      <ul>
        {sensitiveFieldPreview(profile).map((field) => <li key={field}>{field}</li>)}
        {compared.length > 0 && (
          <li data-testid="share-compared">{compared.length} compared {compared.length === 1 ? "area" : "areas"}: {compared.join(", ")}</li>
        )}
      </ul>
      <div className="share-preview-actions">
        <button type="button" onClick={onConfirm}>Confirm share</button>
        <button type="button" onClick={onCancel}>Cancel share</button>
      </div>
    </div>
  );
}

/**
 * Puts the search in the address (#profile=…, never sent to a server) and returns the link: this
 * page's results, the search and the compared areas, and nothing else (no map position or layer state).
 */
function shareProfileUrl(profile: PreferenceProfile, compared: GeographyId[]): string {
  const fragment = encodeSearchLink(profile, compared);
  // replaceState, not location.hash: a hash change is a popstate, which a phone reads as the back gesture closing the sheet.
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${fragment}`);
  return `${window.location.origin}${window.location.pathname}?layer=personal-match${fragment}`;
}

/**
 * "Shared with you": the sender's search on one line ("A shared London search · Buy up to £600k ·
 * 2-bed home · …", clipped with the full text kept for screen readers and on hover) and the two next
 * steps on the second. Stands in for the search summary until the recipient makes it theirs.
 */
function SharedCard({ profile, onEdit }: { profile: PreferenceProfile; onEdit: () => void }) {
  const england = coversEngland(useScope());
  const market = profile.market === "buy" ? "Buy" : "Rent";
  const parts = searchItems(profile).filter((item) => item.criterion.kind !== "budget").map((item) => itemChip(item.criterion, profile));
  const home = homeLabel(profile.bedrooms, profile.houseTypes?.length ? "house" : profile.propertyType ?? "any");
  const summary = [`A shared ${londonWord(england)}search`, `${market} up to ${budgetMoney(profile.maximumBudget, profile.market)}`, home, ...parts].join(" · ");
  return (
    <section className="shared-card" data-testid="shared-banner" aria-label="Shared with you">
      <p className="shared-card__line" title={summary}>{summary}</p>
      <div className="shared-card__actions">
        <button type="button" className="link-button" onClick={onEdit}>Make it mine</button>
        <a className="link-button" href="/guide">What is Close Knit?</a>
      </div>
    </section>
  );
}
