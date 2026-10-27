# Orchestrator resume — 36 proptech tasks

## 1. Restart (workspace root must be the monorepo)

```sh
cd ~/projects
muse --disable-approval
```

## 2. First message to the model

```text
You are orchestrator for 36 proptech tasks in docs/proptech-gap-analysis-2026-09-06/tasks/ (01 to 36, in order).
State: Task 01 is DONE, merged to origin/main as e630729. Start at Task 02.

For each task, one by one, never in parallel:
1. Spawn a subagent to implement it (TDD: failing test first, smallest diff, only files the task names).
2. Review and verify its work yourself: re-run its tests, inspect the diff.
3. If green, merge to main and push to origin. If red, send it back once, then report and move on only if I say so.
4. Do not stop until all 36 are merged or I stop you.

Learned constraints (do not re-discover): target branch is main (no master); Playwright chromium+webkit are preinstalled, never reinstall; sandbox blocks local port binding so e2e webServers can't run here — verify e2e statically plus unit tests, note it honestly; keep functions <=40 lines, nesting <=4; never touch other agents' uncommitted work.
```
