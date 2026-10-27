"use client";

import { useEffect, useRef, useState } from "react";

import { MAX_LIFESTYLE, type Lifestyle, type PreferenceProfile } from "@/lib/contracts";
import {
  applyTailor, HOUSEHOLD_OPTIONS, LIFESTYLE_OPTIONS, suggestedLifestyle, tailorAnswers, type TailorAnswers,
} from "@/lib/tailor";
import { routablePlaces } from "@/lib/commute";
import { track } from "@/lib/usage";

import { CommuteField } from "./commute-field";
import { useDialogFocusTrap } from "./use-focus-trap";
import "../styles/match-panel.css";

const IGNORE_PENDING = () => undefined;

const STEPS = ["Who's moving?", "Buy or rent?", "Where do you go most?", "Up to 3 things you'd use weekly"] as const;

/**
 * Tailor in four one-tap steps (personalisation-spec.md §2). Every step can be skipped and Done is
 * always in reach; skipping everything saves nothing. The answers change the overview's facts and
 * tiles 5-7, never the order. Find my area's dialog, footer and place picker are reused as they are.
 */
export function TailorWizard({ open, profile, onSave, onClose }: {
  open: boolean;
  profile: PreferenceProfile;
  onSave: (profile: PreferenceProfile) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState(profile);
  const [answered, setAnswered] = useState<Set<number>>(new Set());
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      setStep(1);
      setDraft(profile);
      setAnswered(new Set());
      node.showModal();
    }
    if (!open && node.open) node.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useDialogFocusTrap(open, dialog);
  useEffect(() => { if (open) heading.current?.focus(); }, [open, step]);

  const answers = tailorAnswers(draft);
  const answer = (change: Partial<TailorAnswers>, next: number | null) => {
    setDraft((current) => applyTailor(current, { ...tailorAnswers(current), ...change }));
    setAnswered((current) => new Set(current).add(step));
    if (next !== null) setStep(next);
  };
  const done = () => {
    if (JSON.stringify(draft) !== JSON.stringify(profile)) {
      onSave(draft);
      // How many steps were answered, never the answers (personalisation-spec.md §5).
      track("tailor_saved", { steps: answered.size });
    }
    dialog.current?.close();
  };
  const toggle = (id: Lifestyle) => {
    const picked = answers.lifestyle.includes(id);
    answer({ lifestyle: picked ? answers.lifestyle.filter((entry) => entry !== id) : [...answers.lifestyle, id] }, null);
  };
  const suggestion = suggestedLifestyle(answers.household);
  const full = answers.lifestyle.length >= MAX_LIFESTYLE;

  return (
    <dialog ref={dialog} className="preference-panel area-wizard tailor-wizard" aria-labelledby="tailor-heading" onClose={onClose}
      data-testid="tailor-wizard">
      <header>
        <div>
          <p className="eyebrow">Tailor the overview</p>
          <h2 ref={heading} id="tailor-heading" tabIndex={-1}>{STEPS[step - 1]}</h2>
          <p className="wizard-progress" data-testid="tailor-progress" aria-live="polite">Step {step} of {STEPS.length}</p>
        </div>
        <button type="button" onClick={() => dialog.current?.close()} aria-label="Close Tailor">×</button>
      </header>
      <div className="wizard-body">
        {step === 1 && (
          <div className="tailor-options" role="group" aria-label="Who's moving?">
            {HOUSEHOLD_OPTIONS.map((option) => (
              <button key={option.id} type="button" className="chip-button" aria-pressed={answers.household === option.id}
                data-testid={`tailor-household-${option.id}`} onClick={() => answer({ household: option.id }, 2)}>
                {option.label}
              </button>
            ))}
          </div>
        )}
        {step === 2 && (
          <div className="tailor-options tailor-options--two" role="group" aria-label="Buy or rent?">
            {(["buy", "rent"] as const).map((market) => (
              <button key={market} type="button" className="chip-button" aria-pressed={answers.market === market}
                data-testid={`tailor-market-${market}`} onClick={() => answer({ market }, 3)}>
                {market === "buy" ? "Buy" : "Rent"}
              </button>
            ))}
          </div>
        )}
        {step === 3 && (
          <>
            <p className="tailor-note">Getting around then shows the time from each area to it.</p>
            <CommuteField idBase="tailor-place" profile={draft} onPending={IGNORE_PENDING}
              onChange={(next) => {
                setDraft(next);
                setAnswered((current) => new Set(current).add(3));
                if (routablePlaces(next.places).length > routablePlaces(draft.places).length) setStep(4);
              }} />
          </>
        )}
        {step === 4 && (
          <>
            <p className="tailor-note" data-testid="tailor-count" aria-live="polite">
              {answers.lifestyle.length} of {MAX_LIFESTYLE} picked. They take the last tiles of the overview; a flood warning can take one of them.
            </p>
            <div className="tailor-options" role="group" aria-label="Things you'd use weekly">
              {LIFESTYLE_OPTIONS.map((option) => {
                const picked = answers.lifestyle.includes(option.id);
                return (
                  <button key={option.id} type="button" className="chip-button" aria-pressed={picked}
                    disabled={!picked && full} data-testid={`tailor-lifestyle-${option.id}`} onClick={() => toggle(option.id)}>
                    {option.label}
                    {option.id === suggestion && !picked && <small className="tailor-suggested">Suggested</small>}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
      <div className="wizard-nav">
        {step > 1 && <button type="button" onClick={() => setStep(step - 1)}>Back</button>}
        {step < STEPS.length && <button type="button" data-testid="tailor-skip" onClick={() => setStep(step + 1)}>Skip</button>}
        <button type="button" className="wizard-primary" data-testid="tailor-done" onClick={done}>Done</button>
      </div>
    </dialog>
  );
}
