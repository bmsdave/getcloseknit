<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Close Knit design system

Before changing any UI, CSS, chart, map style or icon, read `../DESIGN.md` and follow it:
- Use tokens only, in both Day and Night.
- Charts are satin stitch, lines stem stitch, icons plied yarn, places plain dots (`Dot`), all from `src/components/knit`; never a texture, never system emoji.
- Only the primary action and the chosen tag carry a running stitch; silhouettes stay solid with no gaps between stitches.
- The map stays real; knitting goes only on objects on top of it (yarn routes, dot places, the house).
- One font: Bricolage Grotesque.
- Run `npm test` (including `colour-contrast` and `knit`) and check both themes.
