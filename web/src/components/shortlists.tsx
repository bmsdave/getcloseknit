"use client";

import { useEffect, useMemo, useState } from "react";

import { areaDisplayName } from "@/lib/area-labels";
import type { GeographyId, MatchPack, PreferenceProfile } from "@/lib/contracts";
import type { DataMode } from "@/lib/map-state";
import {
  buildShortlist,
  decodeSharedShortlist,
  deleteShortlist,
  describeShareAssumptions,
  describeShortlistDetails,
  encodeSharedShortlist,
  type ShareInclusions,
  formatSavedTime,
  importSharedShortlist,
  listShortlists,
  refreshShortlistEvidence,
  resolveShortlistCandidates,
  saveShortlist,
  SHORTLIST_FRAGMENT_PREFIX,
  type SavedShortlist,
  type SharedShortlist,
} from "@/lib/saved-shortlists";
import { useShareLink } from "./match/share-link";
import { useResolvedNames } from "./use-area-names";
import { londonWord } from "@/lib/coverage-words";

interface ShortlistPanelProps {
  pack: MatchPack | null;
  profile: PreferenceProfile;
  mode: DataMode;
  release: string;
  compared: GeographyId[];
  onAdoptCandidates: (ids: GeographyId[]) => void;
}

export function ShortlistPanel(props: ShortlistPanelProps) {
  const [shortlists, setShortlists] = useState<SavedShortlist[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [restoredId, setRestoredId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [importHash, setImportHash] = useState<string | null>(null);
  const shared = useShareLink("anyone with it sees what the preview listed");

  useEffect(() => {
    const loaded = listShortlists();
    setShortlists(loaded.shortlists);
    setNotice(storeNotice(loaded.storageDenied, loaded.corrupted));
    function checkImportHash() {
      const hash = window.location.hash;
      setImportHash(hash.startsWith(SHORTLIST_FRAGMENT_PREFIX) ? hash : null);
    }
    checkImportHash();
    window.addEventListener("hashchange", checkImportHash);
    return () => window.removeEventListener("hashchange", checkImportHash);
  }, []);

  function refresh() {
    const loaded = listShortlists();
    setShortlists(loaded.shortlists);
    return loaded;
  }

  function handleSave(name: string, notes: string) {
    const saved = saveCurrent(props, name, notes);
    if (!saved) {
      setNotice("Select at least one compared area before saving a shortlist.");
      return;
    }
    const result = saveShortlist(saved);
    const loaded = refresh();
    setNotice(actionNotice(result.ok, loaded, "Local storage denied this shortlist — nothing was saved."));
  }

  function handleDelete(id: string) {
    const result = deleteShortlist(id);
    if (restoredId === id) setRestoredId(null);
    if (sharingId === id) setSharingId(null);
    const loaded = refresh();
    setNotice(actionNotice(result.ok, loaded, "Local storage denied this change — the shortlist is still saved."));
  }

  function handleRefresh(entry: SavedShortlist) {
    if (!props.pack) return;
    const result = saveShortlist(refreshShortlistEvidence(entry, props.pack));
    const loaded = refresh();
    setNotice(actionNotice(result.ok, loaded, "Local storage denied this change — the saved snapshot is unchanged."));
  }

  const restored = shortlists.find((entry) => entry.id === restoredId) ?? null;
  const sharing = shortlists.find((entry) => entry.id === sharingId) ?? null;

  return (
    <section className="saved-shortlists" data-testid="saved-shortlists" aria-label="Saved shortlists">
      <h2>Saved shortlists</h2>
      {notice && <p role="status">{notice}</p>}
      {shared.status}
      {/* Saving a new shortlist needs a ranked search; without one the saved rows still show (G24). */}
      {props.pack && <SaveForm compared={props.compared} ready onSave={handleSave} />}
      <ShortlistList
        shortlists={shortlists}
        onRestore={setRestoredId}
        onShare={setSharingId}
        onDelete={handleDelete}
      />
      {restored && (
        <RestoreView
          entry={restored}
          pack={props.pack}
          onAdopt={props.onAdoptCandidates}
          onRefresh={() => handleRefresh(restored)}
          onClose={() => setRestoredId(null)}
        />
      )}
      {sharing && (
        <ShareDialog
          entry={sharing}
          onConfirm={(fragment) => { setSharingId(null); void shared.share(shareShortlistUrl(fragment), `A ${londonWord()}shortlist`); }}
          onCancel={() => setSharingId(null)}
        />
      )}
      {importHash && (
        <ImportBanner
          hash={importHash}
          onImported={() => { setImportHash(null); refresh(); }}
          onDismiss={() => setImportHash(null)}
        />
      )}
    </section>
  );
}

function storeNotice(denied: boolean, corrupted: boolean): string | null {
  if (denied) return "Local storage is unavailable — shortlists cannot be saved on this device.";
  if (corrupted) return "One saved entry was unreadable and was left out — the rest still load.";
  return null;
}

function actionNotice(
  ok: boolean,
  loaded: { storageDenied: boolean; corrupted: boolean },
  failure: string,
): string | null {
  if (loaded.storageDenied || loaded.corrupted) return storeNotice(loaded.storageDenied, loaded.corrupted);
  return ok ? null : failure;
}

function saveCurrent(
  props: ShortlistPanelProps,
  name: string,
  notes: string,
): SavedShortlist | null {
  if (!props.pack || props.compared.length === 0) return null;
  const names: Record<string, string> = {};
  for (const result of props.pack.values) names[result.geographyId] = areaDisplayName(result) ?? result.name;
  try {
    return buildShortlist({
      name,
      candidates: [...props.compared],
      candidateNames: Object.fromEntries(props.compared.map((id) => [id, names[id] ?? id])),
      profile: props.profile,
      mode: props.mode,
      release: props.release,
      notes,
      evidence: props.pack,
    });
  } catch {
    return null;
  }
}

/** The shortlist's brief: /brief with the shortlist in the fragment (never sent to a server). */
function shareShortlistUrl(fragment: string): string {
  return `${window.location.origin}/brief${fragment}`;
}

function SaveForm({ compared, ready, onSave }: {
  compared: GeographyId[];
  ready: boolean;
  onSave: (name: string, notes: string) => void;
}) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <form
      className="shortlist-save"
      onSubmit={(event) => { event.preventDefault(); onSave(name, notes); setName(""); setNotes(""); }}
    >
      <label htmlFor="shortlist-name">Shortlist name</label>
      <input
        id="shortlist-name"
        className="knit-field"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="e.g. Two-bed finalists"
        maxLength={80}
      />
      <label htmlFor="shortlist-notes">Private notes (never shared by default)</label>
      <input
        id="shortlist-notes"
        className="knit-field"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="e.g. Revisit South Bank at rush hour"
        maxLength={500}
      />
      <button type="submit" disabled={!ready || compared.length === 0}>
        Save shortlist ({compared.length} compared)
      </button>
    </form>
  );
}

function ShortlistList({ shortlists, onRestore, onShare, onDelete }: {
  shortlists: SavedShortlist[];
  onRestore: (id: string) => void;
  onShare: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (shortlists.length === 0) return <p>Nothing saved yet — compare areas, then save the shortlist.</p>;
  return (
    <ul className="shortlist-list">
      {shortlists.map((entry) => (
        <ShortlistRow key={entry.id} entry={entry} onOpen={() => onRestore(entry.id)} onShare={() => onShare(entry.id)}
          onDelete={() => onDelete(entry.id)} />
      ))}
    </ul>
  );
}

/** One saved shortlist (G38): its name, then "2 areas · Saved 1 Oct 2026, 16:27", then Open, Share, Delete. */
export function ShortlistRow({ entry, onOpen, onShare, onDelete }: {
  entry: SavedShortlist;
  onOpen: () => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const areas = entry.candidates.length;
  return (
    <li className="shortlist-row" data-testid="shortlist-row">
      <span className="shortlist-row__text">
        <strong className="shortlist-row__name">{entry.name}</strong>
        <small className="shortlist-row__meta" data-testid="shortlist-row-meta">
          {areas} {areas === 1 ? "area" : "areas"} · Saved {formatSavedTime(entry.updatedAt)}
        </small>
      </span>
      <span className="shortlist-actions">
        <button type="button" className="area-save-actions__button" aria-label={`Open ${entry.name}`} onClick={onOpen}>Open</button>
        <button type="button" className="area-save-actions__button" aria-label={`Share ${entry.name}`} onClick={onShare}>Share</button>
        <button type="button" className="area-save-actions__button" aria-label={`Delete ${entry.name}`} onClick={onDelete}>Delete</button>
      </span>
    </li>
  );
}

function RestoreView({ entry, pack, onAdopt, onRefresh, onClose }: {
  entry: SavedShortlist;
  pack: MatchPack | null;
  onAdopt: (ids: GeographyId[]) => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const resolution = pack ? resolveShortlistCandidates(entry, pack) : null;
  return (
    <div className="shortlist-restore" data-testid="shortlist-restore" role="dialog" aria-label={`Reloaded ${entry.name}`}>
      <h3>{entry.name} — saved snapshot</h3>
      <p>Saved {formatSavedTime(entry.updatedAt)}.</p>
      <ul>
        {entry.evidence.map((snapshot) => (
          <li key={snapshot.geographyId}>
            {snapshot.name}: {snapshot.score ?? "—"}/100 match · {snapshot.evidenceCompleteness}% evidence
          </li>
        ))}
      </ul>
      {resolution && <ResolutionBody value={resolution} />}
      <ShortlistDetails text={describeShortlistDetails(entry)} />
      <div className="shortlist-actions">
        <button type="button" onClick={() => onAdopt(entry.candidates)}>Show in comparison</button>
        <button type="button" onClick={onRefresh} disabled={!pack}>Refresh from current data</button>
        <button type="button" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function ResolutionBody({ value }: { value: ReturnType<typeof resolveShortlistCandidates> }) {
  return (
    <>
      {!value.releaseAvailable && (
        <p role="status">The data this was saved with is no longer available — showing the saved snapshot, not a substitute.</p>
      )}
      {value.missing.map((gone) => (
        <p key={gone.geographyId} role="status">{gone.name} was {gone.reason} — left out, never replaced.</p>
      ))}
    </>
  );
}

function ShareDialog({ entry, onConfirm, onCancel }: {
  entry: SavedShortlist;
  onConfirm: (fragment: string) => void;
  onCancel: () => void;
}) {
  const [includeDestinations, setIncludeDestinations] = useState(false);
  const [includeBudget, setIncludeBudget] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(false);
  const preview = previewShare(entry, { includeDestinations, includeBudget, includeNotes });
  return (
    <div className="shortlist-share" data-testid="shortlist-share-preview" role="dialog" aria-label="Review shortlist before sharing">
      <h3>Review before sharing</h3>
      <p>Redacted by default. Nothing is shared until you confirm.</p>
      <ul data-testid="shortlist-share-assumptions">
        {preview.assumptions.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <ShortlistDetails text={describeShortlistDetails(entry)} />
      <label>
        <input type="checkbox" checked={includeDestinations} onChange={(event) => setIncludeDestinations(event.target.checked)} />
        Include exact places (destinations, pinned points, drawn areas) in this share
      </label>
      <label>
        <input type="checkbox" checked={includeBudget} onChange={(event) => setIncludeBudget(event.target.checked)} />
        Include the budget in this share
      </label>
      <label>
        <input type="checkbox" checked={includeNotes} onChange={(event) => setIncludeNotes(event.target.checked)} />
        Include private notes in this share
      </label>
      <div className="shortlist-actions">
        <button type="button" onClick={() => onConfirm(preview.fragment)}>Confirm shortlist share</button>
        <button type="button" onClick={onCancel}>Cancel share</button>
      </div>
    </div>
  );
}

function previewShare(entry: SavedShortlist, inclusions: ShareInclusions): { assumptions: string[]; fragment: string } {
  const fragment = encodeSharedShortlist(entry, inclusions);
  const decoded = decodeSharedShortlist(fragment);
  if (!decoded.ok) return { assumptions: ["This shortlist cannot be shared right now."], fragment };
  return { assumptions: describeShareAssumptions(decoded.share), fragment };
}

function ImportBanner({ hash, onImported, onDismiss }: {
  hash: string;
  onImported: () => void;
  onDismiss: () => void;
}) {
  const decoded = decodeSharedShortlist(hash);
  if (!decoded.ok) {
    return (
      <div className="shortlist-import" data-testid="shortlist-import" role="status">
        <p>This shared shortlist link is {decoded.reason === "too-large" ? "too large to open" : "not readable"} — nothing was imported or changed.</p>
        <button type="button" onClick={onDismiss}>Dismiss</button>
      </div>
    );
  }
  return (
    <div className="shortlist-import" data-testid="shortlist-import" role="dialog" aria-label="Import shared shortlist">
      <ImportBody share={decoded.share} onImported={onImported} onDismiss={onDismiss} />
    </div>
  );
}

function ImportBody({ share: read, onImported, onDismiss }: {
  share: SharedShortlist;
  onImported: () => void;
  onDismiss: () => void;
}) {
  // A link sent before v4 stored codes as names ("Haringey 019A"): names are resolved as it is read.
  const candidateNames = useResolvedNames(read.candidates, read.candidateNames);
  const share = useMemo(() => ({ ...read, candidateNames }), [read, candidateNames]);
  function handleImport() {
    const result = saveShortlist(importSharedShortlist(share));
    if (result.ok) onImported();
  }
  return (
    <>
      <h3>Import shared shortlist</h3>
      <ul data-testid="shortlist-import-assumptions">
        {describeShareAssumptions(share).map((line) => <li key={line}>{line}</li>)}
      </ul>
      <ShortlistDetails text={describeShortlistDetails(share)} />
      <div className="shortlist-actions">
        <button type="button" onClick={handleImport}>Import shortlist</button>
        <button type="button" onClick={onDismiss}>Dismiss</button>
      </div>
    </>
  );
}

/** Profile version, data mode and release id: kept for support, folded away from the saved row. */
function ShortlistDetails({ text }: { text: string }) {
  return (
    <details className="shortlist-details">
      <summary>Details</summary>
      <p>{text}</p>
    </details>
  );
}
