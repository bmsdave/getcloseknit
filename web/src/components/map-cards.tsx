"use client";

/**
 * What a tap on the map opens at the top of the sheet (Map controls PR 3–4): one small card per kind of
 * object, in the place card's frame. × closes it, Escape through the Esc ladder (use-escape-ladder.ts:
 * the card is its "card" rung), and a tap on the empty map (close-knit.tsx).
 */
import Link from "next/link";
import { useState } from "react";

import { STATS19_URL, collisionRecordLine, type CollisionRecord } from "@/lib/map-collisions";
import type { MapCard } from "@/lib/map-pick";
import type { SchoolMapCardData } from "@/lib/map-school-layer";

import { PlaceCard } from "./places-panel";
import { SaveItemButton } from "./save-item-button";
import { OfstedIcon } from "./school/ofsted-icon";

export function MapCardView({ card, places, onClose }: { card: MapCard; places: MyPlaceActions; onClose: () => void }) {
  switch (card.kind) {
    case "place": return <PlaceCard place={card.place} onClose={onClose} />;
    case "school": return <SchoolMapCard school={card.school} onClose={onClose} />;
    case "collision": return <CollisionCard card={card} onClose={onClose} />;
    case "tree": return <TreeCard card={card} onClose={onClose} />;
    case "my-place": return <MyPlaceCard key={card.placeId} card={card} actions={places} onClose={onClose} />;
  }
}

function CloseButton({ what, testId, onClose }: { what: string; testId: string; onClose: () => void }) {
  return (
    <button type="button" className="place-card__close" data-testid={testId} aria-label={`Close ${what}`} onClick={onClose}>
      <span aria-hidden="true">×</span>
    </button>
  );
}

/** A school: name with its Ofsted swatch, phase and distance, the peek's tags, its London place and the link to its page. */
function SchoolMapCard({ school, onClose }: { school: SchoolMapCardData; onClose: () => void }) {
  const { view } = school;
  return (
    <section className="place-card" data-testid="school-card" data-urn={view.urn} aria-label={`School: ${view.name}`}>
      <div className="place-card__text">
        <strong className="map-card__name">
          {view.ofsted && <OfstedIcon mark={view.ofsted.mark} label={view.ofsted.label} size={18} className="map-card__ofsted" />}
          {view.name}
        </strong>
        <span>{school.distance ? `${school.detail} · ${school.distance} from your home` : school.detail}</span>
        {view.tags.length > 0 && (
          <ul className="school-pop__tags" data-testid="school-card-tags">
            {view.tags.map((tag) => <li key={tag.label} data-top={tag.top ? "" : undefined}>{tag.label}</li>)}
          </ul>
        )}
        {view.position && <small>{view.position}</small>}
        {view.external
          ? <a href={view.href} target="_blank" rel="noopener noreferrer" data-testid="school-card-link">GIAS record ↗</a>
          : <Link href={view.href} data-testid="school-card-link">Open school page ›</Link>}
      </div>
      {school.save && <SaveItemButton item={school.save} testId="school-card-save" />}
      <CloseButton what="school" testId="school-card-close" onClose={onClose} />
    </section>
  );
}

function RecordLine({ record, who }: { record: CollisionRecord; who: boolean }) {
  return (
    <span className="collision-popup__line">
      <span className="collision-popup__chip" data-severity={String(record.severity)}>{record.label}</span>
      {record.year && <span className="collision-popup__year">{record.year}</span>}
      {record.dark && <span className="collision-popup__dark">Dark</span>}
      {who && <span className="collision-popup__who">{record.who}</span>}
    </span>
  );
}

/** Road collisions: one casualty (severity, year, who, dark), or a stack's count with its first few and Zoom in. */
function CollisionCard({ card, onClose }: { card: Extract<MapCard, { kind: "collision" }>; onClose: () => void }) {
  const { content } = card;
  return (
    <section className="place-card" data-testid="collision-card" aria-label="Road collision">
      <div className="place-card__text">
        {content.kind === "one" ? (
          <>
            <strong className="sr-only">{collisionRecordLine(content.record)}</strong>
            <RecordLine record={content.record} who={false} />
            <span className="collision-popup__who">{content.record.who}</span>
          </>
        ) : (
          <>
            <strong>{content.count} people hurt here</strong>
            {content.records.map((record, index) => <RecordLine key={index} record={record} who />)}
            {content.zoomIn && card.zoomIn && (
              <button type="button" className="collision-popup__zoom" onClick={card.zoomIn}>Zoom in</button>
            )}
          </>
        )}
        <a href={STATS19_URL} target="_blank" rel="noopener noreferrer">STATS19 data ↗</a>
      </div>
      <CloseButton what="collision" testId="collision-card-close" onClose={onClose} />
    </section>
  );
}

/** A street tree: kind, size, age, owner and source. (A green street is a line: it only peeks.) */
function TreeCard({ card, onClose }: { card: Extract<MapCard, { kind: "tree" }>; onClose: () => void }) {
  const [name, ...rest] = card.lines;
  return (
    <section className="place-card" data-testid="tree-card" data-kind="tree" aria-label={`Street tree: ${name}`}>
      <div className="place-card__text">
        <strong>{name}</strong>
        {rest.map((line, index) => <span key={index}>{line}</span>)}
      </div>
      <CloseButton what="street tree" testId="tree-card-close" onClose={onClose} />
    </section>
  );
}

/** What a your-place card can do to the place (close-knit.tsx): the profile's own edits. */
export interface MyPlaceActions {
  /** The place's name now (null once it is removed). */
  nameOf: (id: string) => string | null;
  rename: (id: string, name: string) => void;
  /** The place being moved (tap-to-place), or null. */
  moving: string | null;
  onMove: (id: string | null) => void;
  remove: (id: string) => void;
  /** My match: areas by the commute to this place. */
  commute: (id: string) => void;
}

/** Your place (work, school, gym…): its name, then Rename, Move, Remove and Commute from here. */
function MyPlaceCard({ card, actions, onClose }: { card: Extract<MapCard, { kind: "my-place" }>; actions: MyPlaceActions; onClose: () => void }) {
  const name = actions.nameOf(card.placeId) ?? card.name;
  const [draft, setDraft] = useState<string | null>(null);
  const moving = actions.moving === card.placeId;
  const save = () => {
    const next = draft?.trim().slice(0, 60);
    if (next) actions.rename(card.placeId, next);
    setDraft(null);
  };
  return (
    <section className="place-card" data-testid="my-place-card" data-place={card.placeId} aria-label={`Your place: ${name}`}>
      <div className="place-card__text">
        {draft === null ? <strong>{name}</strong> : (
          <form className="map-card__rename" onSubmit={(event) => { event.preventDefault(); save(); }}>
            <input className="knit-field" value={draft} maxLength={60} aria-label="Name" data-testid="my-place-name" autoFocus
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setDraft(null); } }} />
            <button type="submit" className="map-card__action" data-testid="my-place-save">Save</button>
          </form>
        )}
        <span>{moving ? "Tap the map to move it" : "Your place"}</span>
        <div className="map-card__actions" role="group" aria-label="Your place">
          {draft === null && <button type="button" className="map-card__action" data-testid="my-place-rename" onClick={() => setDraft(name)}>Rename</button>}
          <button type="button" className="map-card__action" data-testid="my-place-move" aria-pressed={moving}
            onClick={() => actions.onMove(moving ? null : card.placeId)}>{moving ? "Cancel" : "Move"}</button>
          <button type="button" className="map-card__action" data-testid="my-place-remove" onClick={() => { actions.remove(card.placeId); onClose(); }}>Remove</button>
          <button type="button" className="map-card__action" data-testid="my-place-commute" onClick={() => actions.commute(card.placeId)}>Commute from here</button>
        </div>
      </div>
      <CloseButton what="your place" testId="my-place-card-close" onClose={onClose} />
    </section>
  );
}
