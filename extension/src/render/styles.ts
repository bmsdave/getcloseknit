// Day tokens from web/src/app/globals.css (DESIGN.md §2): the card sits on light portal pages.
export const FONT_FAMILY = "Close Knit Bricolage";

export const CARD_CSS = `
:host { all: initial; }
.ck {
  --paper: #f4f7fa; --panel: #ffffff; --chip: #eef2f7; --ink: #22252c; --muted: #5b6270;
  --primary: #c0352c; --on-primary: #fff; --stitch: #fff; --wool: #dfe7f0; --focus: #2f5bd3;
  --good: #2f5bd3; --bad: #c0352c; --neutral: #6b7787;
  --radius-md: 10px; --radius-lg: 14px; --radius-pill: 999px;
  font-family: "${FONT_FAMILY}", system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--ink); font-size: 14px; line-height: 1.4; -webkit-font-smoothing: antialiased;
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; box-sizing: border-box;
}
.ck *, .ck *::before, .ck *::after { box-sizing: border-box; }
.ck a { color: inherit; }
.ck :focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.card {
  width: 340px; max-width: calc(100vw - 32px); max-height: calc(100vh - 32px); overflow: auto;
  background: var(--panel); border: 1px solid var(--wool); border-radius: var(--radius-lg);
  box-shadow: 0 12px 32px rgba(22, 32, 58, .18), 0 2px 6px rgba(22, 32, 58, .08);
  padding: 14px 16px 12px; display: grid; gap: 12px;
}
.brand { display: flex; align-items: center; gap: 8px; }
.brand img { width: 26px; height: 26px; border-radius: 7px; }
.wordmark { font-weight: 800; letter-spacing: -0.03em; font-size: 15px; text-transform: lowercase; }
.brand .spacer { flex: 1; }
.icon-button {
  border: 0; background: var(--chip); color: var(--ink); border-radius: var(--radius-pill);
  width: 28px; height: 28px; font: inherit; font-size: 16px; line-height: 1; cursor: pointer;
}
.title { font-size: 18px; font-weight: 750; letter-spacing: -0.02em; text-decoration: none; display: block; }
.title:hover { text-decoration: underline; }
.subtitle { color: var(--muted); font-size: 13px; margin-top: 2px; }
.match { display: grid; gap: 6px; padding: 10px 12px; background: var(--paper); border-radius: var(--radius-md); }
.score { display: flex; align-items: baseline; gap: 6px; }
.score strong { font-size: 28px; font-weight: 800; letter-spacing: -0.03em; }
.score span { color: var(--muted); font-size: 13px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { font-size: 12px; border-radius: var(--radius-pill); padding: 3px 9px; background: var(--chip); }
.chip.good { box-shadow: inset 0 0 0 1.5px var(--good); }
.chip.bad { box-shadow: inset 0 0 0 1.5px var(--bad); }
.facts { display: grid; gap: 7px; margin: 0; padding: 0; list-style: none; }
.fact { display: grid; grid-template-columns: 10px 84px 1fr; gap: 8px; align-items: baseline; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--neutral); transform: translateY(1px); }
.dot.good { background: var(--good); } .dot.bad { background: var(--bad); } .dot.none { visibility: hidden; }
.fact .label { color: var(--muted); font-size: 12px; }
.price { border-top: 1px dashed var(--wool); padding-top: 10px; }
.price .detail, .cta p, .muted { color: var(--muted); font-size: 13px; }
.cta p { margin: 0 0 8px; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
.button {
  position: relative; display: inline-flex; align-items: center; justify-content: center; min-height: 36px;
  padding: 7px 14px; border-radius: var(--radius-pill); font-weight: 650; font-size: 14px; text-decoration: none;
  background: var(--chip); color: var(--ink); border: 0; cursor: pointer;
}
.button.primary { background: var(--primary); color: var(--on-primary); }
.button.primary::after {
  content: ""; position: absolute; inset: 3px; border-radius: inherit; border: 1.5px dashed var(--stitch);
  pointer-events: none;
}
.heading { font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.position { display: grid; gap: 6px; }
.position-label { font-weight: 650; }
.strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px; height: 12px; }
.segment { position: relative; background: var(--chip); border-radius: var(--radius-pill); }
.segment.middle { background: var(--wool); }
.segment.on { box-shadow: inset 0 0 0 1.5px var(--ink); }
.marker {
  position: absolute; left: 50%; top: -3px; width: 4px; height: 18px; margin-left: -2px;
  background: var(--primary); border-radius: var(--radius-pill);
}
.ticks { position: relative; height: 16px; font-size: 11px; color: var(--muted); }
.tick { position: absolute; top: 0; transform: translateX(-50%); white-space: nowrap; }
.tick.t1 { left: 25%; } .tick.t2 { left: 50%; } .tick.t3 { left: 75%; }
.position .muted { font-size: 12px; }
.flags { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.flag { display: grid; grid-template-columns: 10px 1fr; gap: 8px; align-items: baseline; font-size: 13px; }
.more-toggle {
  justify-self: start; border: 0; background: var(--chip); color: var(--ink); border-radius: var(--radius-pill);
  padding: 5px 12px; font: inherit; font-size: 13px; font-weight: 650; cursor: pointer;
}
.more { display: grid; gap: 12px; }
.more[hidden] { display: none; }
.story p { margin: 4px 0 0; }
.changes, .cost-rows { display: grid; gap: 4px; margin: 6px 0 0; padding: 0; list-style: none; font-size: 13px; }
.changes li { display: flex; justify-content: space-between; gap: 8px; }
.costs { display: grid; gap: 6px; }
.story-line { font-size: 14px; }
.story-line .down { color: var(--bad); } .story-line .up { color: var(--ink, #22252c); }
.home { display: grid; gap: 6px; padding: 10px; border-radius: 10px; background: #fdf1cc; }
.home-address { font-weight: 800; }
.costs-total { display: flex; align-items: baseline; gap: 6px; }
.costs-total strong { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
.sections { display: grid; gap: 14px; }
.section .facts { margin-top: 6px; gap: 5px; font-size: 13px; }
.section .fact { grid-template-columns: 10px 104px 1fr; }
.footnote { font-size: 12px; color: var(--muted); }
.footnote a { margin-left: 4px; }
.pill {
  display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--wool); background: var(--panel);
  border-radius: var(--radius-pill); padding: 6px 14px 6px 6px; font: inherit; font-weight: 650; cursor: pointer;
  box-shadow: 0 6px 18px rgba(22, 32, 58, .16); color: var(--ink); max-width: calc(100vw - 32px);
}
.pill img { width: 26px; height: 26px; border-radius: 7px; }
.pill span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar { width: 360px; max-width: calc(100vw - 32px); }
.bar .card { gap: 10px; }
@media (max-width: 480px) {
  .ck { left: 8px; right: 8px; bottom: 8px; }
  .card { width: auto; max-height: 70vh; }
}
`;

/** The inline panel under the portal's price (render/summary.ts): in the page's flow, not floating. */
export const SUMMARY_CSS = `
:host { all: initial; display: block; margin: 12px 0; }
.cks {
  --panel: #ffffff; --paper: #f4f7fa; --chip: #eef2f7; --ink: #22252c; --muted: #5b6270; --wool: #dfe7f0;
  --primary: #c0352c; --on-primary: #fff; --stitch: #fff; --good: #2f5bd3; --bad: #c0352c; --focus: #2f5bd3;
  font-family: "${FONT_FAMILY}", system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--ink); font-size: 13px; line-height: 1.35; -webkit-font-smoothing: antialiased;
  box-sizing: border-box; display: grid; gap: 10px; padding: 12px; background: var(--panel);
  border: 1px solid var(--wool); border-radius: 14px; max-width: 100%;
}
.cks *, .cks *::before, .cks *::after { box-sizing: border-box; }
.cks :focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.cks-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.cks-group { background: var(--paper); border-radius: 10px; padding: 8px 10px; display: grid; gap: 6px; align-content: start; }
.cks-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.cks-title { font-size: 11px; font-weight: 750; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.cks-only {
  font-size: 10px; font-weight: 700; color: var(--primary); border-radius: 999px; padding: 1px 7px;
  box-shadow: inset 0 0 0 1px var(--primary); white-space: nowrap;
}
.cks-rows { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
.cks-row { display: grid; grid-template-columns: 8px 120px 1fr; gap: 6px; align-items: baseline; }
.cks-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.cks-dot.good { background: var(--good); } .cks-dot.bad { background: var(--bad); } .cks-dot.none { visibility: hidden; }
.cks-label { color: var(--muted); font-size: 12px; }
.cks-value { font-weight: 600; }
.cks-pills { display: flex; flex-wrap: wrap; gap: 6px; }
.cks-pill {
  display: inline-flex; align-items: baseline; gap: 5px; border-radius: 999px; padding: 3px 10px; font-size: 12px;
  background: var(--chip); color: var(--ink);
}
.cks-pill-label { opacity: .8; }
.cks-pill.b1 { background: #fbe1de; color: #9e2a22; }
.cks-pill.b2 { background: #fdebd9; color: #9a4a17; }
.cks-pill.b3 { background: #eef2f7; color: #3d4452; }
.cks-pill.b4 { background: #e3ebfb; color: #2a52bd; }
.cks-pill.b5 { background: #cfdcfa; color: #1d3f9e; }
.cks-foot { display: flex; align-items: center; gap: 8px; }
.cks-foot img { width: 20px; height: 20px; border-radius: 5px; }
.cks-wordmark { font-weight: 800; letter-spacing: -0.03em; font-size: 13px; }
.cks-spacer { flex: 1; }
.cks-button {
  position: relative; display: inline-flex; align-items: center; min-height: 30px; padding: 5px 12px;
  border-radius: 999px; border: 0; background: var(--chip); color: var(--ink); font: inherit; font-weight: 650;
  text-decoration: none; cursor: pointer;
}
.cks-button.primary { background: var(--primary); color: var(--on-primary); }
.cks-button.primary::after {
  content: ""; position: absolute; inset: 3px; border-radius: inherit; border: 1.5px dashed var(--stitch); pointer-events: none;
}
.cks-note { color: var(--muted); font-size: 11px; }
/* Placeholders while the card loads (src/swr.ts): the same boxes as the filled panel, so nothing jumps. */
.cks-skel { display: block; height: 10px; border-radius: 5px; background: var(--wool); animation: cks-pulse 1.2s ease-in-out infinite; }
.cks-skel-title { width: 96px; height: 11px; margin: 2px 0; }
.cks-row.pending { align-items: center; min-height: 17px; }
.cks-pill.pending { width: 92px; height: 22px; background: var(--chip); animation: cks-pulse 1.2s ease-in-out infinite; }
@keyframes cks-pulse { 50% { opacity: .5; } }
@media (prefers-reduced-motion: reduce) { .cks-skel, .cks-pill.pending { animation: none; } }
@media (max-width: 480px) { .cks-grid { grid-template-columns: 1fr; } .cks-row { grid-template-columns: 8px 76px 1fr; } }
`;

/** The side panel page: the card fills the panel instead of floating over a page. */
export const PANEL_CSS = `
:host { display: block; margin: 0; }
.ck { position: static; }
.card { width: auto; max-width: none; max-height: none; overflow: visible; border: 0; border-radius: 0; box-shadow: none; }
.cks { padding: 0; border: 0; }
`;

export function fontFaceCss(url: string): string {
  return `@font-face { font-family: "${FONT_FAMILY}"; src: url("${url}") format("woff2"); font-weight: 200 800; font-display: swap; }`;
}
