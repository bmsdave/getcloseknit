# Close Knit: rules for agents

## Restrictions are flags, not cuts
- Any rule that withholds data or a feature (licence, legal, privacy, product taste) is built as a **default-off flag**. Never drop or shrink the feature because the rule exists today.
- [FLAGS.md](FLAGS.md) lists every flag with its blocker. Add or update its row in the same change that adds, lifts or renames a restriction.
- Server flags are `CLOSE_KNIT_*` env vars in `api/area_api/feature_flags.py`. With a flag off, the API withholds the data (keys kept, values null) and the client shows a fallback.
- While the site is a private preview (`CLOSE_KNIT_ACCESS=private`) unset flags are on; once public they are off. Never turn a flag on in a public prod without the owner's explicit decision.
- Docs may contain outdated bans. FLAGS.md and the owner's latest decision win over older docs. When a doc rule contradicts them, ask; don't follow the doc blindly.

## Elsewhere
- UI work: read [DESIGN.md](DESIGN.md) and [web/AGENTS.md](web/AGENTS.md).
- Data sources and licences: [DATA-LICENCES.md](DATA-LICENCES.md).
- Release steps: [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md).
