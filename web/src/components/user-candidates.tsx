"use client";

import { useEffect, useId, useRef, useState } from "react";

import { SaveHeart } from "@/components/area-save-actions";
import { parseAskingPrice } from "@/components/asking-price-check";
import { removeSavedHome } from "@/lib/saved-items";
import { fromProfile, type GeographyId, type SaleRecord } from "@/lib/contracts";
import { loadSearchResults } from "@/lib/postcode-search";
import type { PropertyProfileResponse } from "@/lib/property-profile";
import { fetchSectionJson } from "@/lib/section-fetch";
import {
  buildUserCandidate,
  candidateConflicts,
  describeAskingVsAchieved,
  editUserCandidate,
  emptyCandidateStore,
  loadUserCandidates,
  normalizeCandidateAddress,
  saveUserCandidates,
  type AskingKind,
  type CandidateOfficial,
  type KnownAddress,
  type PriceUnit,
  type UserCandidate,
} from "@/lib/user-candidates";

interface UserCandidatesProps {
  directory: KnownAddress[];
  histories: Record<string, SaleRecord>;
  epcAreas: Record<string, number[]>;
  /** Real mode: addresses come from /api/v1/search and histories from each home's profile. */
  search?: boolean;
}

const SAVE_ERRORS: Record<string, string> = {
  "invalid-price-units": "Price unit does not match the asking kind: a sale needs £ total, rent needs £ per month.",
  "invalid-price": "Asking amount must be a positive number.",
  "malformed-url": "Listing link must be an http(s) URL or left empty.",
  "duplicate-candidate": "This home is already saved with the same asking figure.",
};

export function UserCandidatesPanel(props: UserCandidatesProps) {
  const [candidates, setCandidates] = useState<UserCandidate[]>([]);
  const [denied, setDenied] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    const loaded = loadUserCandidates();
    setCandidates(loaded.store.candidates);
    setDenied(loaded.storageDenied);
  }, []);
  const profiled = useCandidateHistories(props.search ? candidates.map((candidate) => candidate.uprn) : []);
  function commit(next: UserCandidate[]) {
    setCandidates(next);
    if (!saveUserCandidates({ ...emptyCandidateStore(), candidates: next }).ok) setDenied(true);
  }
  return (
    <section className="user-candidates" data-testid="user-candidates" aria-label="Homes you're considering">
      <h2>Homes you&apos;re considering</h2>
      {denied && <p role="status">Local storage is unavailable — homes will not survive reload.</p>}
      {status && <p data-testid="candidate-status" role="status">{status}</p>}
      <CandidateForm
        directory={props.directory}
        search={props.search ?? false}
        existing={candidates}
        onSaved={(candidate) => { commit([...candidates, candidate]); setStatus(`Home saved: ${candidate.address.value}.`); }}
        onError={(reason) => setStatus(SAVE_ERRORS[reason] ?? "Could not save this home.")}
      />
      {candidates.length === 0 && <p>No homes yet.</p>}
      <CandidateList
        candidates={candidates}
        officialOf={(candidate) => officialFor(candidate, { ...props.histories, ...profiled }, props.epcAreas)}
        onEdit={(candidate, patch) => applyCandidateEdit(candidates, candidate, patch, commit, setStatus)}
      />
    </section>
  );
}

function applyCandidateEdit(
  candidates: UserCandidate[],
  candidate: UserCandidate,
  patch: { askingAmount?: number; notes?: string },
  commit: (next: UserCandidate[]) => void,
  setStatus: (message: string) => void,
): void {
  const edited = editUserCandidate(candidate, patch);
  if (!edited.ok) { setStatus(SAVE_ERRORS[edited.reason] ?? "Could not save these changes."); return; }
  commit(candidates.map((entry) => (entry.id === candidate.id ? edited.candidate : entry)));
  setStatus(`Home updated: ${edited.candidate.address.value}.`);
}

function CandidateList({ candidates, officialOf, onEdit }: {
  candidates: UserCandidate[];
  officialOf: (candidate: UserCandidate) => CandidateOfficial;
  onEdit: (candidate: UserCandidate, patch: { askingAmount?: number; notes?: string }) => void;
}) {
  return (
    <>
      {candidates.map((candidate) => (
        <CandidateCard
          key={candidate.id}
          candidate={candidate}
          official={officialOf(candidate)}
          onEdit={(patch) => onEdit(candidate, patch)}
        />
      ))}
    </>
  );
}

function officialFor(
  candidate: UserCandidate,
  histories: Record<string, SaleRecord>,
  epcAreas: Record<string, number[]>,
): CandidateOfficial {
  const history = candidate.uprn ? (histories[candidate.uprn] ?? null) : null;
  const areas = candidate.uprn ? (epcAreas[candidate.uprn] ?? historyAreas(history)) : [];
  return { history, epcAreasSqm: areas };
}

function historyAreas(history: SaleRecord | null): number[] {
  const areas = (history?.transactions ?? [])
    .map((entry) => entry.floorAreaSquareMetres)
    .filter((area): area is number => area !== null);
  return [...new Set(areas)];
}

function CandidateForm({ directory: known, search, existing, onSaved, onError }: {
  directory: KnownAddress[];
  search: boolean;
  existing: UserCandidate[];
  onSaved: (candidate: UserCandidate) => void;
  onError: (reason: string) => void;
}) {
  const draft = useCandidateDraft();
  const matches = useAddressMatches(search, draft.values.address);
  const directory = search ? matches : known;
  function save() {
    const result = buildUserCandidate(collectCandidateInput(draft.values, directory), directory, existing);
    if (!result.ok) { onError(result.reason); return; }
    onSaved(result.candidate);
    draft.reset();
  }
  return (
    <form aria-label="Add a home" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <AddressFields directory={directory} address={draft.values.address} onAddress={draft.setAddress} referenceUrl={draft.values.referenceUrl} onReferenceUrl={draft.setReferenceUrl} />
      <AskingFields askingKind={draft.values.askingKind} onKind={draft.setKind} askingAmount={draft.values.askingAmount} onAskingAmount={draft.setAskingAmount} priceUnit={draft.values.priceUnit} onPriceUnit={draft.setPriceUnit} />
      <DetailFields bedrooms={draft.values.bedrooms} onBedrooms={draft.setBedrooms} floorArea={draft.values.floorArea} onFloorArea={draft.setFloorArea} notes={draft.values.notes} onNotes={draft.setNotes} />
      <button className="chip-button" type="submit">Save home</button>
    </form>
  );
}

function useCandidateDraft() {
  const [address, setAddress] = useState("");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [askingKind, setAskingKind] = useState<AskingKind>("sale");
  const [askingAmount, setAskingAmount] = useState("");
  const [priceUnit, setPriceUnit] = useState<PriceUnit>("gbp-total");
  const [bedrooms, setBedrooms] = useState("");
  const [floorArea, setFloorArea] = useState("");
  const [notes, setNotes] = useState("");
  function setKind(kind: AskingKind) {
    setAskingKind(kind);
    setPriceUnit(kind === "sale" ? "gbp-total" : "gbp-per-month");
  }
  function reset() {
    setAddress(""); setReferenceUrl(""); setAskingAmount("");
    setBedrooms(""); setFloorArea(""); setNotes("");
  }
  return {
    values: { address, referenceUrl, askingKind, askingAmount, priceUnit, bedrooms, floorArea, notes } as CandidateDraft,
    setAddress, setReferenceUrl, setKind, setAskingAmount, setPriceUnit, setBedrooms, setFloorArea, setNotes, reset,
  };
}

/**
 * Real mode: the homes (with a UPRN) matching the typed address, from the
 * same /api/v1/search the header uses. The last answer stays until the next
 * one arrives, so a picked address still links when saved straight away.
 */
function useAddressMatches(enabled: boolean, text: string): KnownAddress[] {
  const [matches, setMatches] = useState<KnownAddress[]>([]);
  useEffect(() => {
    const query = text.trim();
    if (!enabled || query.length < 3) { setMatches([]); return; }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void loadSearchResults(query, controller)
        .then((results) => {
          if (controller.signal.aborted) return;
          setMatches(results.filter((result) => result.uprn !== null)
            .map((result) => ({ uprn: result.uprn, address: result.label, geographyId: result.geographyId })));
        })
        .catch(() => undefined);
    }, 200);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [enabled, text]);
  return matches;
}

/** Real mode: each home's recorded sales by UPRN, read from its property profile. */
export function useCandidateHistories(uprns: (string | null)[]): Record<string, SaleRecord> {
  const [histories, setHistories] = useState<Record<string, SaleRecord>>({});
  const key = [...new Set(uprns.filter((uprn): uprn is string => uprn !== null))].sort().join(",");
  useEffect(() => {
    let current = true;
    for (const uprn of key.split(",").filter(Boolean)) {
      void fetchSectionJson<PropertyProfileResponse>(`/api/v1/properties/${encodeURIComponent(uprn)}/profile`).then((payload) => {
        if (current && payload?.profile) setHistories((known) => ({ ...known, [uprn]: fromProfile(payload.profile) }));
      });
    }
    return () => { current = false; };
  }, [key]);
  return histories;
}

interface CandidateDraft {
  address: string;
  referenceUrl: string;
  askingKind: AskingKind;
  askingAmount: string;
  priceUnit: PriceUnit;
  bedrooms: string;
  floorArea: string;
  notes: string;
}

function collectCandidateInput(draft: CandidateDraft, directory: KnownAddress[]) {
  const match = directory.find((entry) => entry.address === draft.address.trim());
  return {
    addressText: draft.address.trim(),
    uprn: match?.uprn ?? null,
    referenceUrl: draft.referenceUrl.trim() === "" ? undefined : draft.referenceUrl.trim(),
    askingKind: draft.askingKind,
    askingAmount: Number(draft.askingAmount),
    priceUnit: draft.priceUnit,
    bedrooms: draft.bedrooms.trim() === "" ? null : Number(draft.bedrooms),
    floorAreaSqm: draft.floorArea.trim() === "" ? null : Number(draft.floorArea),
    notes: draft.notes.trim() === "" ? undefined : draft.notes,
  };
}

function AddressFields({ directory, address, onAddress, referenceUrl, onReferenceUrl }: {
  directory: KnownAddress[];
  address: string;
  onAddress: (value: string) => void;
  referenceUrl: string;
  onReferenceUrl: (value: string) => void;
}) {
  return (
    <>
      <label>Home address
        <input aria-label="Home address" value={address} onChange={(event) => onAddress(event.target.value)} list="candidate-addresses" placeholder="Type or pick a known address" />
      </label>
      <datalist id="candidate-addresses">
        {directory.map((entry) => <option key={entry.uprn ?? entry.address} value={entry.address} />)}
      </datalist>
      <label>Listing link (optional)
        <input aria-label="Listing link (optional)" value={referenceUrl} onChange={(event) => onReferenceUrl(event.target.value)} placeholder="https://…" inputMode="url" />
      </label>
    </>
  );
}

function AskingFields({ askingKind, onKind, askingAmount, onAskingAmount, priceUnit, onPriceUnit }: {
  askingKind: AskingKind;
  onKind: (kind: AskingKind) => void;
  askingAmount: string;
  onAskingAmount: (value: string) => void;
  priceUnit: PriceUnit;
  onPriceUnit: (unit: PriceUnit) => void;
}) {
  return (
    <>
      <label>Asking kind
        <select aria-label="Asking kind" value={askingKind} onChange={(event) => onKind(event.target.value as AskingKind)}>
          <option value="sale">For sale</option>
          <option value="rent">To rent</option>
        </select>
      </label>
      <label>Asking amount
        <input aria-label="Asking amount" value={askingAmount} onChange={(event) => onAskingAmount(event.target.value)} inputMode="decimal" placeholder={askingKind === "sale" ? "600000" : "2400"} />
      </label>
      <label>Price unit
        <select aria-label="Price unit" value={priceUnit} onChange={(event) => onPriceUnit(event.target.value as PriceUnit)}>
          <option value="gbp-total">£ total</option>
          <option value="gbp-per-month">£ per month</option>
        </select>
      </label>
    </>
  );
}

function DetailFields({ bedrooms, onBedrooms, floorArea, onFloorArea, notes, onNotes }: {
  bedrooms: string;
  onBedrooms: (value: string) => void;
  floorArea: string;
  onFloorArea: (value: string) => void;
  notes: string;
  onNotes: (value: string) => void;
}) {
  return (
    <>
      <label>Bedrooms (optional)
        <input aria-label="Bedrooms (optional)" value={bedrooms} onChange={(event) => onBedrooms(event.target.value)} inputMode="numeric" />
      </label>
      <label>Floor area in square metres (optional)
        <input aria-label="Floor area in square metres (optional)" value={floorArea} onChange={(event) => onFloorArea(event.target.value)} inputMode="decimal" />
      </label>
      <label>Private notes (optional)
        <input aria-label="Private notes (optional)" value={notes} onChange={(event) => onNotes(event.target.value)} placeholder="Your own note, kept on this device" maxLength={500} />
      </label>
    </>
  );
}

export function CandidateCard({ candidate, official, onEdit }: {
  candidate: UserCandidate;
  official: CandidateOfficial;
  onEdit: (patch: { askingAmount?: number; notes?: string }) => void;
}) {
  const comparison = describeAskingVsAchieved(candidate, official.history);
  const conflicts = candidateConflicts(candidate, official);
  return (
    <article data-testid="user-candidate" aria-label={`Home ${candidate.address.value}`}>
      <h3>{candidate.address.value}</h3>
      <p>{unverifiedLine(candidate.address.observedAt)}</p>
      <LinkageLine candidate={candidate} />
      <div data-testid="candidate-asking">
        {comparison.asking && candidate.asking ? (
          <>
            <strong>{comparison.asking.label}: £{comparison.asking.amount.toLocaleString("en-GB")} {comparison.asking.unit}</strong>
            <p>{unverifiedLine(candidate.asking.observedAt)}</p>
          </>
        ) : <strong>No asking price yet: add it below when you have the listing.</strong>}
      </div>
      <CandidateFacts candidate={candidate} />
      {conflicts.length > 0 && (
        <ul data-testid="candidate-conflicts">
          {conflicts.map((conflict) => <li key={conflict.kind}><strong>{conflict.kind}:</strong> {conflict.detail}</li>)}
        </ul>
      )}
      <OfficialHistorySection candidate={candidate} official={official} note={comparison.note} achieved={comparison.achieved} />
      <CandidateEditor candidate={candidate} onEdit={onEdit} />
    </article>
  );
}

function CandidateFacts({ candidate }: { candidate: UserCandidate }) {
  return (
    <>
      {candidate.referenceUrl && <p>Listing link: {candidate.referenceUrl.value} · {unverifiedLine(candidate.referenceUrl.observedAt)}</p>}
      {candidate.bedrooms !== null && <p>{candidate.bedrooms.value} bedrooms · {unverifiedLine(candidate.bedrooms.observedAt)}</p>}
      {candidate.floorAreaSqm !== null && <p>{candidate.floorAreaSqm.value} sqm · {unverifiedLine(candidate.floorAreaSqm.observedAt)}</p>}
      {candidate.notes && <p>Note: {candidate.notes.value} · {unverifiedLine(candidate.notes.observedAt)}</p>}
    </>
  );
}

function OfficialHistorySection({ candidate, official, note, achieved }: {
  candidate: UserCandidate;
  official: CandidateOfficial;
  note: string;
  achieved: { date: string; nominalPrice: number }[];
}) {
  const [showHistory, setShowHistory] = useState(false);
  if (!official.history) return <p>No official history yet.</p>;
  return (
    <>
      <button className="chip-button" type="button" onClick={() => setShowHistory((value) => !value)}>
        {showHistory ? "Hide" : "Show"} official history for {candidate.address.value}
      </button>
      {showHistory && (
        <div data-testid="candidate-official-history">
          <p>{note}</p>
          <ul>
            {achieved.map((entry) => (
              <li key={entry.date}>Achieved £{entry.nominalPrice.toLocaleString("en-GB")} on {entry.date} (official record)</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function CandidateEditor({ candidate, onEdit }: {
  candidate: UserCandidate;
  onEdit: (patch: { askingAmount?: number; notes?: string }) => void;
}) {
  const [askingDraft, setAskingDraft] = useState(candidate.asking ? String(candidate.asking.value.amount) : "");
  const [notesDraft, setNotesDraft] = useState(candidate.notes?.value ?? "");
  return (
    <>
      <label>Edit asking amount for {candidate.address.value}
        <input aria-label={`Edit asking amount for ${candidate.address.value}`} value={askingDraft} onChange={(event) => setAskingDraft(event.target.value)} inputMode="decimal" />
      </label>
      <label>Edit notes for {candidate.address.value}
        <input aria-label={`Edit notes for ${candidate.address.value}`} value={notesDraft} onChange={(event) => setNotesDraft(event.target.value)} maxLength={500} />
      </label>
      <button className="chip-button" type="button" onClick={() => onEdit({ askingAmount: askingDraft.trim() ? Number(askingDraft) : undefined, notes: notesDraft })}>
        Save changes for {candidate.address.value}
      </button>
    </>
  );
}

function LinkageLine({ candidate }: { candidate: UserCandidate }) {
  if (candidate.linkage.status === "linked") {
    return <p>Linked to official records via {candidate.linkage.matchMethod} (confidence {candidate.linkage.confidence}).</p>;
  }
  return (
    <div>
      <p>Not linked to any official record ({candidate.linkage.reason}); your home is kept as entered.</p>
      {candidate.linkage.options && (
        <ul>{candidate.linkage.options.map((option) => <li key={option}>Possible match kept separate: {option}</li>)}</ul>
      )}
    </div>
  );
}

function unverifiedLine(observedAt: string): string {
  return `unverified · observed ${observedAt.slice(0, 10)}`;
}

/** Fired on window after a save here, so every Save this home on the page shows the same state. */
export const CANDIDATES_CHANGED = "close-knit:candidates-changed";

/** The saved candidate for this home: same UPRN, or the same address when there is none. */
export function savedCandidateFor(candidates: UserCandidate[], uprn: string | null, address: string): UserCandidate | null {
  const key = normalizeCandidateAddress(address);
  return candidates.find((candidate) => (uprn !== null && candidate.uprn === uprn)
    || normalizeCandidateAddress(candidate.address.value) === key) ?? null;
}

/**
 * Save this home (review #12, property pages): one press keeps the home in the
 * user-candidates store on this device, linked by its UPRN, and says so
 * (role=status). The asking price is optional: "Add asking price" opens a field
 * so the brief and the area page's candidates can set it against the recorded
 * sales. Nothing leaves the browser.
 */
export function SaveHome({ address, uprn, geographyId, label = "Save this home", testId = "save-home", heart = false }: {
  address: string; uprn: string | null; geographyId: GeographyId | null; label?: string; testId?: string;
  /** ♡ only (the property page's header): a second press unsaves; the asking price is added elsewhere. */
  heart?: boolean;
}) {
  const [saved, setSaved] = useState<UserCandidate | null>(null);
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState("");
  const [status, setStatus] = useState("");
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) field.current?.focus(); }, [open]);
  useEffect(() => {
    const read = () => setSaved(savedCandidateFor(loadUserCandidates().store.candidates, uprn, address));
    read();
    window.addEventListener(CANDIDATES_CHANGED, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(CANDIDATES_CHANGED, read);
      window.removeEventListener("storage", read);
    };
  }, [uprn, address]);
  function keep(candidates: UserCandidate[], message: string): boolean {
    if (!saveUserCandidates({ ...emptyCandidateStore(), candidates }).ok) {
      setStatus("This browser is not keeping data for this site, so the home could not be saved.");
      return false;
    }
    setStatus(message);
    window.dispatchEvent(new Event(CANDIDATES_CHANGED));
    return true;
  }
  function save() {
    const existing = loadUserCandidates().store.candidates;
    const directory = geographyId ? [{ uprn, address, geographyId }] : [];
    const result = buildUserCandidate({ addressText: address, uprn, askingKind: "sale", askingAmount: null, priceUnit: "gbp-total" },
      directory, existing);
    if (!result.ok) { setStatus(SAVE_ERRORS[result.reason] ?? "Could not save this home."); return; }
    keep([...existing, result.candidate], "Saved on this device. It is in your brief.");
  }
  function addAsking() {
    const amount = parseAskingPrice(asking);
    if (amount === null) { setStatus("Type the asking price in pounds, like 650000."); return; }
    const existing = loadUserCandidates().store.candidates;
    const current = savedCandidateFor(existing, uprn, address);
    if (!current) { setOpen(false); return; }
    const edited = editUserCandidate(current, { askingAmount: amount, priceUnit: "gbp-total" });
    if (!edited.ok) { setStatus(SAVE_ERRORS[edited.reason] ?? "Could not add the asking price."); return; }
    if (keep(existing.map((candidate) => candidate.id === current.id ? edited.candidate : candidate),
      "Asking price added. Your brief sets it beside the recorded sales.")) {
      setOpen(false);
      setAsking("");
    }
  }
  function unsave() {
    if (!saved) return;
    setStatus(removeSavedHome(saved.id) ? "Removed from your brief." : "This browser is not keeping data for this site.");
  }
  if (heart) {
    return (
      <span className="save-home save-home--heart" data-testid={testId}>
        <button type="button" className="save-heart" data-testid={`${testId}-heart`} aria-pressed={saved !== null}
          aria-label={label} title={saved ? "Saved" : "Save"} onClick={saved ? unsave : save}>
          <SaveHeart filled={saved !== null} />
        </button>
        <span className="sr-only" role="status" data-testid={`${testId}-status`}>{status}</span>
      </span>
    );
  }
  return (
    <div className="save-home" data-testid={testId} data-open={open ? "" : undefined}>
      {!saved ? (
        <button type="button" className="property-button" onClick={save}>{label}</button>
      ) : (
        <span className="save-home__done" data-testid={`${testId}-saved`}>Saved to your brief</span>
      )}
      {saved && !saved.asking && !open && (
        <button type="button" className="save-home__add" data-testid={`${testId}-add-asking`}
          onClick={() => { setOpen(true); setStatus(""); }}>Add asking price</button>
      )}
      {open && (
        <div className="save-home__form" role="group" aria-labelledby={`${id}-label`}>
          <label id={`${id}-label`} htmlFor={`${id}-asking`} className="save-home__label">Asking price on the listing</label>
          <input ref={field} id={`${id}-asking`} className="knit-field save-home__input" inputMode="numeric" autoComplete="off"
            value={asking} placeholder="650,000" aria-describedby={`${id}-hint`}
            onChange={(event) => setAsking(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") addAsking(); }} />
          <p id={`${id}-hint`} className="save-home__hint">Optional · this browser only</p>
          <span className="save-home__buttons">
            <button type="button" className="property-button" onClick={addAsking}>Add</button>
            <button type="button" className="property-button save-home__cancel" onClick={() => { setOpen(false); setStatus(""); }}>Cancel</button>
          </span>
        </div>
      )}
      <p className="save-home__status" role="status" data-testid={`${testId}-status`}>{status}</p>
    </div>
  );
}
