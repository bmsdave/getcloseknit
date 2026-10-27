# Execution waves and dependency policy

Tasks run in isolated worktrees and merge through an orchestrator. A task may start only when every dependency in its file is present in the starting revision. “Parallel” means different primary files and different test ownership; it never permits editing another agent's worktree.

## Wave 0 — baseline

Run UX-01, then UX-66. UX-66 classifies all twelve browser failures before product expectations change.

## Wave 1 — trust and search lanes, then responsive repair

- **1A data trust:** UX-02 → UX-03 → UX-04 → UX-05 → UX-06 → UX-07 → UX-08 → UX-09 → UX-10 → UX-11 → UX-12 → UX-13.
- **1B search:** UX-14 → UX-15 → UX-16 → UX-17.
- **1C responsive repair:** UX-18 → UX-19 → UX-20, after 1A and 1B are integrated.

Lanes 1A and 1B may run concurrently after Wave 0 because their primary files do not overlap. Merge and verify both, then run lane 1C serially from the integrated revision because its responsive CSS is shared by later surfaces. Start Wave 2 only after UX-20.

## Wave 2 — preference journey

Run UX-21 through UX-33 in numeric order. These tasks share PreferencePanel, controller state, and responsive CSS, so do not parallelize them.

## Wave 3 — evidence architecture

Run UX-34 through UX-44 in numeric order. UX-39 through UX-40 receive the cost and leasehold tools removed by UX-31 and UX-32.

## Wave 4 — comparison

Run UX-45 through UX-54 in numeric order. Start only after evidence navigation and the critical overflow repair are integrated.

## Wave 5 — map and accessibility

Run UX-55 → UX-56 → UX-57 → UX-58 → UX-59, then UX-60 → UX-61 → UX-62 → UX-63 → UX-64 → UX-65. The two lanes are ordered because both may change global responsive and accessibility styles.

## Wave 6 — stabilization

After all feature lanes and UX-66, run UX-67 → UX-68 → UX-69 → UX-70 → UX-71 → UX-72 → UX-73 → UX-74 strictly in order. These tasks share browser-test and release-gate ownership, so parallel execution would create avoidable conflicts.

## Integration gate

Before merging any task, the orchestrator inspects the focused diff, reruns the named focused command, verifies type checking, confirms cleanup, and rejects unrelated edits. After each wave, run `npm test`, `npm run typecheck`, and the browser specs touched by that wave. Do not update snapshots until UX-71.

## Dependency diagram

```text
UX-01 → UX-66
  ├─ UX-02…13 ─┐
  └─ UX-14…17 ─┴─ UX-18…20 → UX-21…33 → UX-34…44 → UX-45…54
                                                       ↓
                    UX-55…59 → UX-60…65 → UX-67…74
```

Every task appears exactly once in the wave descriptions or stabilization chains above; the individual files are authoritative for fine-grained dependencies.
