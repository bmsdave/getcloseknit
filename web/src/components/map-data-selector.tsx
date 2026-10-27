"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { rankingForLayer } from "@/lib/area-pages";
import type { MapDefinition, MapLayerId, MetricId } from "@/lib/contracts";
import { customLayerId, type CustomCriterion } from "@/lib/custom-criteria";
import { isMsoaFigure } from "@/lib/census-layers";
import { CUSTOM_PRESETS } from "@/lib/custom-presets";
import type { LegendScaleMode } from "@/lib/legend-scale";
import { LONDON_ONLY_LABEL } from "@/lib/map-coverage";
import { useScope } from "@/components/scope-context";
import { coversEngland } from "@/lib/scope";
import { isLayerAvailableInMode, MERGED_LAYERS, type DataMode } from "@/lib/map-state";
import type { DetailLayerId } from "@/lib/nature-layers";
import {
  activeTopicPick, activeTopicSubview, activeTopicView, FLAT_ITEM_VIEWS, hasTimeline, isFlatGroup, isRankedLayer, isSinglePeriod, MAP_OVERLAYS,
  presetOfLayer, scaleForTopic, searchTopics, topicLayers, visibleTopicGroups,
  type MapTopic, type TopicGroupId, type TopicPicks, type TopicView,
} from "@/lib/map-topics";
import { changeBasePeriod } from "@/lib/map-trend";
import { periodYearsBefore, type ChangeWindow } from "@/lib/price-change";

import { KnitIcon } from "./knit/knit-icon";
import { Builder } from "./match/my-criteria";
import { track } from "@/lib/usage";

export interface ScaleControls {
  period: string;
  scaleMode: LegendScaleMode;
  changeWindow: ChangeWindow;
  excludedCrime: string[];
  onScaleMode: (mode: LegendScaleMode) => void;
  onChangeWindow: (window: ChangeWindow) => void;
  onToggleCrime: (category: string) => void;
  onResetCrime: () => void;
  /** Leaves every listed type out. */
  onClearCrime: (categories: string[]) => void;
}

interface MapDataSelectorProps {
  layer: MapLayerId;
  /** The layer painted, for the change window's base year. */
  metric: MapDefinition;
  mode: DataMode;
  /** None: the plain map, no colours (Show's overlays stand out). */
  plain: boolean;
  onPlain: () => void;
  /** The household's own criteria, listed in My criteria. */
  custom: CustomCriterion[];
  /** Flagged layers the release leaves out (lib/map-topics.ts hiddenTopicLayers): not offered. */
  hidden?: readonly string[];
  /** Layers whose data is London's alone (lib/map-topics.ts londonOnlyLayers): "London only" on the England map. */
  londonOnly?: ReadonlySet<string>;
  /** Crime types present in the painted pack; empty for other layers. */
  crimeCategories: string[];
  controls: ScaleControls;
  /** Period and ▶ (price-timeline-control.tsx), under Price per m² only: the one layer with monthly history. */
  timeline?: ReactNode;
  /** A metric, or a street layer (Green streets). */
  onLayer: (id: MetricId | DetailLayerId) => void;
  onCriterion: (criterion: CustomCriterion) => void;
}

/** The change scale's windows on the menu: the board's three, plus a longer one a link already carries. */
const CHANGE_PILLS: readonly ChangeWindow[] = [1, 5, 10];

/**
 * "Colour the map by", the Layers menu (map-layers.tsx): a small search, None (the plain map), then the
 * groups in decision order (Cost, Transport, Crime, …) as an accordion: a tap opens a group in place
 * (one open at a time, a chevron), never a step away with a way back. A small group shows every
 * item's views at once (Cost: Price per m² [Actual] [Rank] [Change] with the timeline under it, Typical
 * price [All] … [Detached] "Latest"); one button across the menu is chosen, as the map has one layer.
 * In a longer group only the item shown opens its views (Ethnic makeup › Asian, Crime's types, Country
 * of birth's search). The item shown is one pill (fill, check, "Top 10 →") unless it has controls under
 * it; then the light block holds them. A closed group names the item it holds. Rows carry words only;
 * colours are chosen in ≡ › Map. Keyboard: arrows move between rows, Enter chooses, Escape closes.
 */
export function MapDataSelector(props: MapDataSelectorProps) {
  const { layer, controls, custom, plain } = props;
  const groups = visibleTopicGroups(custom, props.hidden);
  const shown = MERGED_LAYERS[layer as MetricId] ?? layer;
  const isCurrent = (item: MapTopic) => !plain && topicLayers(item).includes(shown);
  const currentGroup = plain ? null : groups.find((group) => group.items.some(isCurrent))?.id ?? null;
  const [open, setOpen] = useState<TopicGroupId | null>(currentGroup);
  const [query, setQuery] = useState("");
  const [building, setBuilding] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const searching = query.trim() !== "";
  const results = searching ? searchTopics(query, custom, props.hidden) : [];

  // Focus starts on the item shown (its group opens with the menu), else on None or the first group.
  useEffect(() => {
    const target = root.current?.querySelector<HTMLElement>(".topic-item[aria-current='true']")
      ?? root.current?.querySelector<HTMLElement>("[data-topic-nav]");
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest" });
  }, []);

  const navItems = () => [...(root.current?.querySelectorAll<HTMLElement>("[data-topic-nav]") ?? [])];

  function criterionFor(item: MapTopic): CustomCriterion | null {
    if (!item.layer) return null;
    if (item.kind === "preset") return CUSTOM_PRESETS.find((entry) => customLayerId(entry.criterion) === item.layer)?.criterion ?? null;
    if (item.kind === "custom") return custom.find((criterion) => customLayerId(criterion) === item.layer) ?? null;
    return null;
  }

  function choose(item: MapTopic) {
    if (!item.layer) {
      setBuilding(!building);
      return;
    }
    const criterion = criterionFor(item);
    if (criterion) {
      props.onCriterion(criterion);
      return;
    }
    if (!isCurrent(item)) props.onLayer(item.layer as MetricId | DetailLayerId);
    const scale = scaleForTopic(item, controls.scaleMode);
    if (scale !== controls.scaleMode) controls.onScaleMode(scale);
  }

  function chooseView(item: MapTopic, view: TopicView) {
    track("layer_subview", { layer: item.id, view: view.id });
    // A view that is a ready-made criterion (Cafés › Independent) opens it as one.
    const preset = presetOfLayer(view.layer);
    if (preset) {
      props.onCriterion(preset.criterion);
      return;
    }
    if (view.layer) props.onLayer(view.layer as MetricId | DetailLayerId);
    // A scale view (Rank) from a view with its own layer (Borough HPI): back to the item's layer.
    else if (item.layer && shown !== item.layer) props.onLayer(item.layer as MetricId);
    // A type of home from Price per m² · Rank: Typical price has no rank, so actual values; so is a view with its own layer.
    const scale = view.scale ?? (view.layer ? "linear" : scaleForTopic(item, controls.scaleMode));
    if (scale !== controls.scaleMode) controls.onScaleMode(scale);
  }

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      navItems()[0]?.focus();
    } else if (event.key === "Enter" && results[0]) {
      event.preventDefault();
      choose(results[0]);
    }
  };

  // Up and down move between the rows (None, the groups, the items); Home and End jump; up from the first goes to the search.
  const onNavKey = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (!target.matches("[data-topic-nav]")) return;
    const options = navItems();
    const index = options.indexOf(target);
    if (event.key === "ArrowUp" && index === 0) {
      event.preventDefault();
      root.current?.querySelector<HTMLInputElement>(".topic-search input")?.focus();
      return;
    }
    const next = { ArrowDown: Math.min(index + 1, options.length - 1), ArrowUp: Math.max(index - 1, 0), Home: 0, End: options.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    options[next]?.focus();
  };

  const row = (item: MapTopic, flat: boolean) => (
    <TopicRow key={item.id} item={item} flat={flat} current={isCurrent(item)} building={building}
      onChoose={() => choose(item)} onView={(view) => chooseView(item, view)}
      onBuilt={(criterion) => { setBuilding(false); props.onCriterion(criterion); }} {...props} />
  );

  return (
    <div className="topic-picker" ref={root} data-testid="data-selector" onKeyDown={onNavKey}>
      <label className="topic-search">
        <span className="sr-only">Search layers</span>
        <KnitIcon name="search" colour="var(--icon-yarn, var(--ink))" className="topic-search__icon" style={{ width: 16, height: 16 }} />
        <input type="search" data-testid="topic-search" placeholder="Search layers" autoComplete="off"
          value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onSearchKey} />
      </label>
      {searching ? (
        <div className="topic-results" role="region" aria-label="Search results">
          {results.length === 0 && <p className="topic-empty" role="status">Nothing matches “{query.trim()}”.</p>}
          {results.length > 0 && <p className="sr-only" role="status">{results.length} found</p>}
          <ul className="topic-list">{results.map((item) => row(item, false))}</ul>
        </div>
      ) : (
        <ul className="topic-menu" aria-label="Layers">
          <li>
            <button type="button" className="topic-none" data-topic-nav data-testid="layer-none" aria-pressed={plain} onClick={props.onPlain}>
              <span className="topic-item__name">None</span>
              {plain && <KnitIcon name="check" colour="currentColor" className="layer-option-check" style={{ width: 16, height: 16 }} />}
            </button>
          </li>
          {groups.map((group) => {
            const expanded = open === group.id;
            const held = !expanded && group.id === currentGroup ? group.items.find(isCurrent) : undefined;
            const flat = isFlatGroup(group);
            return (
              <li key={group.id} className="topic-group" data-open={expanded || undefined}>
                {/* data-fold: an open group is not a disclosure Escape closes first; Escape closes the menu. */}
                <button type="button" className="topic-group__head" data-topic-nav data-fold data-testid={`topic-group-${group.id}`}
                  aria-expanded={expanded} aria-controls={`${id}-${group.id}`} data-current={group.id === currentGroup || undefined}
                  onClick={() => setOpen(expanded ? null : group.id)}>
                  <span className="topic-group__label">{group.label}</span>
                  {held && (
                    <>
                      <span className="topic-group__held" data-testid={`topic-group-held-${group.id}`}>{held.label}</span>
                      <span className="topic-group__dot" aria-hidden="true" />
                    </>
                  )}
                  <KnitIcon name="chevron" colour="var(--icon-yarn, currentColor)" className="topic-group__chevron" style={{ width: 16, height: 16 }} />
                </button>
                {expanded && <ul className="topic-list" id={`${id}-${group.id}`} aria-label={group.label}>{group.items.map((item) => row(item, flat))}</ul>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * One item. Chosen without controls: one pill (fill, check and "Top 10 →" in it). With views (always in a
 * small group, else once chosen) or other controls once chosen: the name row over them, in a light
 * block only while it is the one shown. Otherwise a plain row.
 */
function TopicRow(props: MapDataSelectorProps & {
  item: MapTopic;
  flat: boolean;
  current: boolean;
  building: boolean;
  onChoose: () => void;
  onView: (view: TopicView) => void;
  onBuilt: (criterion: CustomCriterion) => void;
}) {
  const { item, current, controls, layer } = props;
  const available = !item.layer || isLayerAvailableInMode(item.layer, props.mode);
  // The layer shown links to its London ranking, when it has one (Tenure's Social rent and Wealth's views have their own).
  const rankedLayer = current ? MERGED_LAYERS[layer as MetricId] ?? layer : item.layer;
  const ranking = current && rankedLayer && isRankedLayer(rankedLayer) ? rankingForLayer(rankedLayer) : null;
  const view = current ? activeTopicView(item, { layer, scaleMode: controls.scaleMode }) : null;
  const views = item.views && (props.flat || current) ? item.views : null;
  // The timeline is Price per m²'s own months: not under Borough HPI (one period).
  const timeline = hasTimeline(item) && !view?.layer ? props.timeline : null;
  const more = current && (!!view?.subviews || !!item.picks || view?.scale === "change" || (item.id === "crime" && props.crimeCategories.length > 0)
    || !!timeline);
  const builder = !item.layer && props.building;
  // A layer with London's data alone on the England map (lib/map-coverage.ts): blank outside London, and said so.
  const londonOnly = useServesEngland() && !!item.layer && !!props.londonOnly?.has(item.layer);
  const name = (
    <button type="button" className="topic-item" data-topic-nav data-testid={item.layer ? `layer-${item.layer}` : `topic-${item.id}`}
      data-views={item.views ? "" : undefined} aria-current={current || undefined} aria-disabled={!available || undefined}
      aria-expanded={item.layer ? undefined : props.building} data-fold={item.layer ? undefined : ""} onClick={props.onChoose}>
      {current && !views && !more && <KnitIcon name="check" colour="currentColor" className="layer-option-check" style={{ width: 16, height: 16 }} />}
      <span className="topic-item__text">
        <span className="topic-item__name">{item.label}</span>
        {!available && <small>Unavailable in Real data</small>}
        {available && londonOnly && <small data-testid={`london-only-${item.layer}`}>{LONDON_ONLY_LABEL}</small>}
      </span>
    </button>
  );
  const top = ranking && (
    <Link href={ranking} className="topic-top" data-testid="layer-top-10" aria-label={`Top 10: ${item.label}`}>Top 10 →</Link>
  );
  if (!views && !more && !builder) {
    return (
      <li className={current ? "topic-pill" : "topic-plain"} data-current={current || undefined}>
        {name}
        {top}
      </li>
    );
  }
  return (
    <li className="topic-block" data-current={current || undefined}>
      <div className="topic-row">
        {name}
        {isSinglePeriod(item) && <span className="topic-latest">Latest</span>}
        {top}
      </div>
      {current ? (
        // The item shown: its views and controls together (topic-details).
        <div className="topic-more" data-testid="topic-details">
          {views && <TopicViews item={item} views={views} active={view} onView={props.onView} londonOnly={props.londonOnly} />}
          {/* What the view shows, in one line (Green & trees › Green cover: "all greenery from satellite, gardens too"). */}
          {view?.note && <p className="scale-note topic-view-note" data-testid="topic-view-note">{view.label} · {view.note}</p>}
          {more && <TopicMore {...props} timeline={timeline} view={view} />}
        </div>
      ) : views && <TopicViews item={item} views={views} active={null} onView={props.onView} londonOnly={props.londonOnly} />}
      {builder && <Builder onUse={props.onBuilt} />}
    </li>
  );
}

/** An item's views as chips; more than six fold behind "+n" (Wildlife seen's species). */
function TopicViews({ item, views, active, onView, londonOnly }: {
  item: MapTopic; views: readonly TopicView[]; active: TopicView | null; onView: (view: TopicView) => void; londonOnly?: ReadonlySet<string>;
}) {
  const [unfolded, setUnfolded] = useState(false);
  const activeIndex = active ? views.findIndex((entry) => entry.id === active.id) : -1;
  const folded = views.length > FLAT_ITEM_VIEWS && !unfolded && activeIndex < FLAT_ITEM_VIEWS - 1;
  const listed = folded ? views.slice(0, FLAT_ITEM_VIEWS - 1) : views;
  const england = useServesEngland();
  // A view with London's data alone (Green cover, Green streets) says so in its tooltip on the England map.
  const hint = (entry: TopicView) => (england && entry.layer && londonOnly?.has(entry.layer) ? `${entry.label} · ${LONDON_ONLY_LABEL}` : undefined);
  return (
    <div className="topic-subviews topic-views" role="group" aria-label={`${item.label}: show`}>
      {listed.map((entry) => (
        <button key={entry.id} type="button" aria-pressed={active?.id === entry.id} data-testid={`view-${item.id}-${entry.id}`}
          title={hint(entry)} aria-label={hint(entry)} onClick={() => onView(entry)}>
          {entry.label}
        </button>
      ))}
      {folded && (
        <button type="button" aria-pressed={false} data-testid={`views-more-${item.id}`} aria-label={`${views.length - listed.length} more`}
          onClick={() => setUnfolded(true)}>
          +{views.length - listed.length}
        </button>
      )}
    </div>
  );
}

/** Under the item shown: a view's subviews, a search over its picks, the change window, the timeline, or Crime's types. */
function TopicMore({ item, view, onView, layer, metric, controls, crimeCategories, timeline }: MapDataSelectorProps & {
  item: MapTopic;
  view: TopicView | null;
  onView: (view: TopicView) => void;
}) {
  const change = view?.scale === "change";
  const basePeriod = periodYearsBefore(controls.period, controls.changeWindow);
  const baseMissing = change && changeBasePeriod(controls.period, controls.changeWindow, metric.periods) === null;
  const subview = activeTopicSubview(item, { layer, scaleMode: controls.scaleMode });
  return (
    <>
      {view?.subviews && (
        <div className="topic-subviews" role="group" aria-label={`${item.label}, ${view.label}: show`} data-testid="topic-subviews">
          {view.subviews.map((entry) => (
            <button key={entry.id} type="button" aria-pressed={subview?.id === entry.id} data-testid={`view-${item.id}-${entry.id}`} onClick={() => onView(entry)}>
              {entry.label}
            </button>
          ))}
        </div>
      )}
      {item.picks && <TopicPicker picks={item.picks} active={activeTopicPick(item, { layer })} onPick={onView} />}
      {change && <ChangeWindowPills value={controls.changeWindow} onChange={controls.onChangeWindow} />}
      {baseMissing && <p className="scale-note" data-testid="change-unavailable">No prices for {basePeriod ?? "that year"}: try fewer years.</p>}
      {hasTimeline(item) && timeline}
      {item.id === "crime" && crimeCategories.length > 0 && <CrimeFilter categories={crimeCategories} controls={controls} />}
    </>
  );
}

/** A long list of layers (Country of birth's countries, Main language's languages): a search over chips, and what their figures cover. */
function TopicPicker({ picks, active, onPick }: { picks: TopicPicks; active: TopicView | null; onPick: (view: TopicView) => void }) {
  const [query, setQuery] = useState("");
  const id = useId();
  const words = query.trim().toLowerCase();
  const options = words ? picks.options.filter((option) => option.label.toLowerCase().includes(words)) : picks.options;
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || !options[0]) return;
    event.preventDefault();
    onPick(options[0]);
  };
  return (
    <div className="topic-picks" data-testid="topic-picks">
      <label className="topic-picks__label" htmlFor={`${id}-search`}>{picks.label}</label>
      <input id={`${id}-search`} type="search" className="knit-field" data-testid="topic-picks-search" placeholder={picks.search} autoComplete="off"
        value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKey} />
      {/* A language (per area) under Country of birth's MSOA note: no "whole MSOA" line for it. */}
      {picks.note && <p className="scale-note" data-testid="topic-picks-note">{picks.note}{active?.layer && isMsoaFigure(active.layer) ? `: ${active.label} is shown for each whole MSOA.` : "."}</p>}
      {options.length > 0 ? (
        <div className="topic-subviews topic-picks__list" role="group" aria-label={picks.label}>
          {options.map((option) => (
            <button key={option.id} type="button" aria-pressed={active?.id === option.id} data-testid={`pick-${option.id}`} onClick={() => onPick(option)}>
              {option.label}
            </button>
          ))}
        </div>
      ) : <p className="topic-empty" role="status">Nothing matches “{query.trim()}”.</p>}
    </div>
  );
}

/** "over 1 · 5 · 10 years", inline under Change; a window a link carries (3, 20) shows as its own pill. */
function ChangeWindowPills({ value, onChange }: { value: ChangeWindow; onChange: (window: ChangeWindow) => void }) {
  const windows = CHANGE_PILLS.includes(value) ? CHANGE_PILLS : [...CHANGE_PILLS, value].sort((a, b) => a - b);
  return (
    <div className="topic-window" role="group" aria-label="Change over" data-testid="change-window">
      <span>over</span>
      <span className="topic-subviews">
        {windows.map((years) => (
          <button key={years} type="button" aria-pressed={value === years} data-testid={`change-window-${years}`}
            aria-label={`${years} ${years === 1 ? "year" : "years"}`} onClick={() => onChange(years)}>{years}</button>
        ))}
      </span>
      <span>years</span>
    </div>
  );
}

function CrimeFilter({ categories, controls }: { categories: string[]; controls: ScaleControls }) {
  const excluded = controls.excludedCrime;
  return (
    <fieldset className="crime-filter" data-testid="crime-filter">
      <legend>Types</legend>
      <div className="crime-filter-list">
        {categories.map((category) => (
          <label key={category}>
            <input type="checkbox" checked={!controls.excludedCrime.includes(category)} onChange={() => controls.onToggleCrime(category)}
              aria-label={`Include ${category}`} />{category}
          </label>
        ))}
      </div>
      <div className="crime-filter-actions">
        <button type="button" className="chip-button" data-testid="crime-all" disabled={excluded.length === 0} onClick={controls.onResetCrime}>Show all</button>
        <button type="button" className="chip-button" data-testid="crime-none" disabled={categories.every((category) => excluded.includes(category))}
          onClick={() => controls.onClearCrime(categories)}>Clear all</button>
      </div>
    </fieldset>
  );
}

/** The ⓘ beside a Show item's name: a disclosure for its method and licence, one open at a time. */
function OverlayAbout({ id, label, open, onToggle }: {
  id: OverlayId; label: string; open: boolean; onToggle: (id: OverlayId | null) => void;
}) {
  return (
    <button type="button" className="topic-overlay__about" data-testid={`${id}-about-toggle`} aria-expanded={open}
      aria-controls={open ? `overlay-about-${id}` : undefined} aria-label={`About ${label}`} onClick={() => onToggle(open ? null : id)}>
      <KnitIcon name="info" colour="var(--icon-yarn, currentColor)" className="knit-glyph" style={{ width: 16, height: 16 }} />
    </button>
  );
}

interface Overlay {
  on: boolean;
  onChange: (on: boolean) => void;
  /** Its own controls, under its row while it is on. */
  panel?: ReactNode;
  /** False: shown greyed with `note` saying when it applies. */
  available?: boolean;
  note?: string;
  /** Method and licence behind an ⓘ beside the item's name, not in its panel. */
  about?: ReactNode;
}

type OverlayId = (typeof MAP_OVERLAYS)[number]["id"];

/** Whether the site serves England (the layout's scope): London-only layers say so. */
function useServesEngland(): boolean {
  return coversEngland(useScope());
}

const OVERLAY_TEST_IDS: Record<OverlayId, string> = {
  places: "places-toggle", schools: "schools-toggle", sales: "sales-toggle", stations: "stations-toggle",
  mine: "my-places-toggle", "cycle-lanes": "cycle-lanes-toggle", collisions: "collisions-toggle", trees: "street-trees-toggle",
};

/**
 * Show (map-layers.tsx): what is drawn over whatever colours the map, as tick-boxes keyed by their yarn
 * (Local places, Schools, Recent sales, Stations, My places, Cycle lanes, Road collisions, Street trees), each with its own controls once
 * on; then drawing an area for My match (`extra`).
 */
export function MapOverlays({ overlays, extra }: { overlays: Partial<Record<OverlayId, Overlay>>; extra?: ReactNode }) {
  const [about, setAbout] = useState<OverlayId | null>(null);
  const england = useServesEngland();
  return (
    <fieldset className="topic-overlays" data-testid="map-overlays">
      <legend className="sr-only">Show on map</legend>
      {MAP_OVERLAYS.map((info) => {
        const overlay = overlays[info.id];
        if (!overlay) return null;
        const available = overlay.available ?? true;
        return (
          <div key={info.id} className="topic-overlay-row">
            <div className="topic-overlay-line">
              <label className="topic-overlay" data-available={available}>
                <input type="checkbox" data-testid={OVERLAY_TEST_IDS[info.id]} checked={available && overlay.on} disabled={!available}
                  onChange={(event) => overlay.onChange(event.target.checked)} />
                <span className="topic-item__text">
                  <span className="topic-item__name">{info.label}</span>
                  {!available && overlay.note && <small>{overlay.note}</small>}
                  {available && england && "londonOnly" in info && <small data-testid={`london-only-${info.id}`}>{LONDON_ONLY_LABEL}</small>}
                </span>
                <span className="topic-overlay__yarn" aria-hidden="true" style={{ background: info.yarn }} />
              </label>
              {overlay.about && <OverlayAbout id={info.id} label={info.label} open={about === info.id} onToggle={setAbout} />}
            </div>
            {overlay.about && about === info.id && (
              <div className="topic-overlay-about" id={`overlay-about-${info.id}`} data-testid={`${info.id}-about`}>{overlay.about}</div>
            )}
            {available && overlay.on && overlay.panel}
          </div>
        );
      })}
      {extra}
    </fieldset>
  );
}
