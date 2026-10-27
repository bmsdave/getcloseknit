# London user-validation study protocol (AE-34)

Pre-registered before any sessions. No session has run under this protocol,
no participant has been contacted, and no finding is reported here. Any change
to the rules below after sessions start requires a dated amendment that keeps
the original text readable.

## Objective

Test whether budget, commute, and explicit area comparison plus a sourced
decision brief help London households reach a defensible shortlist, and
separate what existing property portals already do from any unique Area
Explorer value. Behavioural evidence so far comes from non-UK studies and
selected anecdotes; this study does not assume London demand, willingness to
pay, or that an extra score improves decisions.

## Consent and handling

Adults only, voluntary, with written informed consent before each session:
purpose, what is observed, that Fixture data is illustrative rather than
official, the right to stop at any point, and how notes are kept. Collect the
minimum needed for the measures below. Keep profiles on the participant's own
view of the tool; persist only explicitly consented, redacted session notes.
Never persist raw profiles, exact destinations, or request bodies, consistent
with [privacy.py](../api/area_api/privacy.py). Halt the study on any privacy
incident until the cause is fixed. Recruitment messages require a separately
authorized communication action; none are written or sent here.

## Sample

Eight to twelve London households, a qualitative discovery sample rather than
a prevalence survey:

- Split across buyers and renters.
- Include movers considering unfamiliar areas, not only locals refining a
  known shortlist.
- Vary commute needs (no commute, one fixed destination, multiple
  destinations) and school needs (no school-age children, primary, secondary).
- Recruit beyond friends and team contacts where feasible; a majority of
  households must come from outside the team's personal network. Record the
  recruitment channel per household in the evidence summary.

## Method

Observe the current workflow first, then test the new surface:

1. Watch the household plan a shortlist with the portals and tools they
   already use. Note the decision jobs those tools already cover.
2. Ask them to compare a shortlist of areas and produce a decision brief with
   the current fixture surface, which stays clearly labelled as preview until
   real data is ready, per the [README](../README.md).
3. Debrief with open questions before any mention of payment.

Facilitators do not explain scores up front and do not correct mistakes
during the task; confusion is data. The exercised surface is the shortlist
comparison, tradeoff relaxation, and decision brief in
[personal-match-panel.tsx](../web/src/components/personal-match-panel.tsx).

## Portal versus unique value

For each household, record which decision jobs their usual portals already
settle (e.g. price filtering, listing discovery, commute lookups) and which,
if any, the comparison and brief add: tradeoff reasoning, missing-evidence
awareness, or a concrete next investigation. A feature counts as unique value
only when a participant connects it to a decision they could not already make.

## Measures

- Task completion: reaches a shortlist with stated reasons, or the point and
  reason where the attempt stalls.
- Comprehension of uncertainty: can the participant explain achieved versus
  asking price, the source carrier and its coarseness, and what evidence is
  missing. Misunderstanding blocks product claims even when completion is high.
- Time and external tabs needed to reach a defensible shortlist, compared
  with the participant's usual process. Faster counts only if comprehension
  and evidence quality do not deteriorate.
- Unresolved questions: every question the session leaves open, kept verbatim
  in redacted form.
- Explicit willingness to pay: which output they would pay for, in what form,
  and reasons for refusal. Stated intent is kept separate from observed reuse;
  this sample cannot establish conversion or market size.

## Pre-registered success rules

- Advance a task area when most households complete it, explain its
  uncertainty back correctly, and connect it to a next investigation.
  Candidate areas to judge this way are preferences and tradeoffs, side-by-side
  comparison, and the decision brief.
- Narrow a task area when completion succeeds but comprehension repeatedly
  fails on one factor: simplify that factor before adding more layers.
- Stop a task area when households consistently cannot connect it to a useful
  decision, or when additional metrics confuse shortlist reasoning. Stopping
  after a failed test is a valid outcome.

## Pre-registered stop rules

Pause or stop the study when labels fail (participants treat preview fixtures
as official statistics despite the wording), when no unfamiliar-area mover can
use the surface at all, when consent comprehension fails, or on any privacy
incident. Report the stop and its reason; do not reword labels mid-sample
without a dated amendment and a fresh household count.

## Contradictions

Findings that go against the proposition get their own evidence-summary
section with redacted participant wording: features nobody values, confusion
the team did not predict, and any case where a portal already covers the job.
A session that contradicts the plan counts the same as one that supports it.

## Evidence summary and cleanup

The study is done when an evidence summary names which decision jobs users
value, what they misunderstand, and which task areas to advance, narrow, or
stop, feeding preferences, comparison, and brief work. The same change removes
unsupported marketing claims from the README and roadmap-tracked files and
defers proposed features participants could not connect to a decision. No
claim of statistically significant conversion effects may be drawn from this
sample, and none is made here.
