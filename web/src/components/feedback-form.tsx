"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";

import { newFeedbackId, sendFeedback } from "@/lib/feedback";

import { KnitIcon } from "./knit/knit-icon";

/** A reason chip on the feedback form: its stored tag and its words. */
export interface VoteReason { tag: string; label: string }

const STARS = ["Terrible", "Poor", "OK", "Good", "Great"] as const;
const MAX_MESSAGE = 2000;

const HIGH: VoteReason[] = [
  { tag: "easy_to_use", label: "Easy to use" },
  { tag: "useful_data", label: "Useful data" },
  { tag: "found_areas", label: "Found good areas" },
  { tag: "looks_good", label: "Looks good" },
  { tag: "fast", label: "Fast" },
];
const LOW: VoteReason[] = [
  { tag: "hard_to_use", label: "Hard to use" },
  { tag: "missing_data", label: "Missing data" },
  { tag: "wrong_data", label: "Wrong data" },
  { tag: "not_covered", label: "My area isn't covered" },
  { tag: "slow", label: "Slow" },
  { tag: "broken", label: "Something broke" },
];

/** What the chips ask after a rating: what worked (4-5 stars) or what got in the way (1-3). */
export function reasonsFor(rating: number): { title: string; tags: VoteReason[] } {
  return rating >= 4 ? { title: "What worked well?", tags: HIGH } : { title: "What got in the way?", tags: LOW };
}

/**
 * "How's Close Knit so far?": five stars, reasons that follow the rating, and optional text
 * (lib/feedback.ts). Anonymous: no contact field, and the text is scrubbed of contact details.
 */
export function FeedbackForm({ initialRating, onDone, showTitle = true }: {
  initialRating?: number; onDone?: () => void;
  /** False where the page's own heading already asks the question (/feedback). */
  showTitle?: boolean;
}) {
  const [rating, setRating] = useState<number | null>(initialRating ?? null);
  const [tags, setTags] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const stars = useRef<(HTMLButtonElement | null)[]>([]);
  const titleId = useId();
  const reasonsId = useId();
  const titleClass = showTitle ? "feedback-form__title" : "sr-only";

  const rate = (next: number, focus = false) => {
    if (rating === null || (rating >= 4) !== (next >= 4)) setTags([]);
    setRating(next);
    if (focus) stars.current[next - 1]?.focus();
  };

  const onStarKey = (event: KeyboardEvent<HTMLButtonElement>, value: number) => {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    rate(Math.min(5, Math.max(1, value + step)), true);
  };

  const send = async () => {
    if (rating === null) return;
    setState("sending");
    const ok = await sendFeedback({ client_id: newFeedbackId(), kind: "review", surface: "site", rating, tags,
      message: message.trim() || undefined });
    setState(ok ? "sent" : "failed");
    if (ok) onDone?.();
  };

  if (state === "sent") {
    return (
      <div className="feedback-form" data-testid="feedback-thanks" role="status">
        <h2 className="feedback-form__title">Thank you!</h2>
        <p>Every note is read. It helps decide what to fix and what to build next.</p>
      </div>
    );
  }

  const reasons = rating === null ? null : reasonsFor(rating);
  return (
    <form className="feedback-form" aria-labelledby={titleId} onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <h2 className={titleClass} id={titleId}>How&apos;s Close Knit so far?</h2>
      <div className="feedback-form__stars" role="radiogroup" aria-labelledby={titleId} data-testid="feedback-stars">
        {STARS.map((label, index) => {
          const value = index + 1;
          const chosen = rating !== null && value <= rating;
          return (
            <button key={label} type="button" role="radio" aria-checked={rating === value} aria-label={`${value} – ${label}`}
              tabIndex={(rating ?? 1) === value ? 0 : -1} ref={(node) => { stars.current[index] = node; }}
              className="feedback-form__star" data-chosen={chosen ? "" : undefined} data-testid={`star-${value}`}
              onClick={() => rate(value)} onKeyDown={(event) => onStarKey(event, value)}>
              <KnitIcon name="star" colour={chosen ? "var(--yarn-sun)" : "var(--muted)"} className="knit-glyph" />
              <span className="feedback-form__star-label" aria-hidden="true">{label}</span>
            </button>
          );
        })}
      </div>
      {reasons && (
        <fieldset className="feedback-form__reasons">
          <legend id={reasonsId}>{reasons.title}</legend>
          <div className="quick-vote__reasons">
            {reasons.tags.map(({ tag, label }) => (
              <button key={tag} type="button" className="chip-button" aria-pressed={tags.includes(tag)}
                data-testid={`feedback-reason-${tag}`}
                onClick={() => setTags((current) => current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag])}>
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <label className="feedback-form__message">
        <span className="sr-only">Your feedback</span>
        <textarea className="knit-field" rows={4} maxLength={MAX_MESSAGE} value={message} data-testid="feedback-message"
          placeholder={rating !== null && rating >= 4 ? "What did you like most?" : "What would make it better?"}
          onChange={(event) => setMessage(event.target.value)} />
      </label>
      {message.length > MAX_MESSAGE - 200 && (
        <p className="feedback-form__count" aria-live="polite">{MAX_MESSAGE - message.length} characters left</p>
      )}
      <p className="feedback-form__note">Please don&apos;t include names or contact details. We can&apos;t reply — this form is anonymous.</p>
      {state === "failed" && (
        <p className="feedback-form__error" role="alert" data-testid="feedback-error">Couldn&apos;t send that. Please try again in a moment.</p>
      )}
      <button type="submit" className="primary-action feedback-form__send" disabled={rating === null || state === "sending"}
        data-testid="feedback-send">{state === "sending" ? "Sending…" : "Send"}</button>
    </form>
  );
}
