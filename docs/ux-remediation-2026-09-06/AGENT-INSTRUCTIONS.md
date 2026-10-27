# Agent instructions

You are implementing one task from this pack. Work only on the named task and treat its dependencies as already merged contracts.

1. Create an isolated worktree from the orchestrator-provided revision. Never copy untracked files from another checkout and never edit another agent's worktree.
2. Read the task, root AGENTS.md, VISION.md, the Close Knit README, web AGENTS.md, and the linked source/test entry points. Current merged code overrides stale line numbers.
3. Write or update the focused test first. Run it and observe the exact expected failure before changing product code. A control is covered only when the test operates it and asserts the effect.
4. Implement the smallest clear behavior. Keep one source of truth, preserve existing contracts, split functions beyond repository structural limits, and avoid comments that restate code.
5. Delete the old path, unused import, stale selector, duplicate state, or retired test replaced by the change. Do not keep parallel implementations for compatibility unless the task explicitly requires it.
6. Run the focused command, `npm test`, and `npm run typecheck`. Run `npm run build` for component/Next.js changes. Browser-facing work requires browser interaction or rendering validation as named in the task.
7. Inspect the final diff and status. Do not commit lockfiles, generated outputs, screenshots, logs, or unrelated changes unless the task names them.
8. Commit one coherent change. Return a handoff of at most 180 words containing behavior, files, failing/passing evidence, cleanup, commit, risks, and evidence paths.

Never weaken a test to match broken behavior, invent production evidence, allow Real mode to fall back to fixtures, lower the 10ms frame budget, or change iOS/Android/pipeline/SDK scope. If a dependency is missing, stop and report the exact missing task rather than recreating it.
