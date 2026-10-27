# Watching for new listings

Nothing is stored on Close Knit. The watch is a scheduled task in the user's own Claude that
re-reads the portal searches and reports only what is new.

## Set it up

1. Confirm the search: areas (ids), buy/rent, max price, min bedrooms, must-haves in the user's
   words (e.g. "outdoor space, not ground floor"), and daily or weekly.
2. `build_watch_spec(name, area_ids, market, max_price, min_bedrooms, must_haves, frequency)` →
   `spec` and `schedulePrompt`.
3. Create the scheduled task with the client's own scheduler, using `schedulePrompt` as the task
   prompt and the frequency from the spec:
   - **Claude Code / Claude Desktop (Code tab):** the scheduled-tasks tool if it is available,
     otherwise suggest `/schedule` with the prompt.
   - **Claude Desktop chat / claude.ai:** if no scheduling tool is available, give the user the
     prompt in a code block and tell them where to paste it (a scheduled task or a recurring
     reminder), so they can set it up in one step.
   Ask before creating it; say how often it runs and how to stop it.
4. Seen listings: the prompt keeps reported listing URLs in the state file named in the spec
   (`~/.close-knit/watches/<slug>.json`, a JSON list of URLs). Create the folder and file on
   the first run if the client has file access; without file access, ask the task to compare
   with the previous run's report instead.

## When the task runs

Follow `schedulePrompt` exactly: open each search once, collect listings, drop the ones already in
the state file, check new ones with `assess_listing`, report a short list (or "nothing new" in one
line), then append their URLs to the state file.
