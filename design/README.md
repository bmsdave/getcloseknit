# Design exploration

How the knitted design system in [`../DESIGN.md`](../DESIGN.md) was found:

- `brand-options/`: the first ten logo sketches (rejected: flat shapes, "stickers").
- `knit-study/`: the first stitch-level knit study, the turning point. Knitting has to be built from stitches.
- `directions/`: ten whole-product directions (screenshots), plus the Python knit renderer (`knitlib.py`) and asset script that drew them.
  - Chosen: 01 (knitted houses and charts) with 06 (bright, warm colours and rib cuffs) for Day, and 10 (night town) for Night.
  - Rejected: 03, 04, 05, 08 and 09.
- `map-screens/`: the map in both themes. It is a real map with real ONS zones, a yarn route, dot places and stitched buttons. `map.html` and `screens_assets.py` rendered it.

The app does not use these files. Its knitting is `web/src/lib/knit.ts`.
