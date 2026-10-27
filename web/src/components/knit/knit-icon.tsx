/**
 * A thread icon (DESIGN.md › Icons): the glyph is one plied yarn strand
 * (shadow, body, twist, highlight) laid along a 24×24 path from
 * lib/thread-icons.ts. Thread, not pixels: legible at 20px, soft at 48px.
 */
import { memo, type CSSProperties } from "react";

import { THREAD_ICONS } from "@/lib/thread-icons";

import { tone } from "./index";

/** Any unknown name draws a small loop, as the old icons drew a circle. */
const FALLBACK = "place-other";
const WIDTH = 2.3;

export const KNIT_ICON_NAMES = Object.keys(THREAD_ICONS);

type KnitIconProps = { name: string; colour?: string; className?: string; style?: CSSProperties };

/** Icons re-render with their parents (the map's controls on every timeline step) with equal props and a fresh style object. */
function sameIcon(previous: KnitIconProps, next: KnitIconProps): boolean {
  if (previous.name !== next.name || previous.colour !== next.colour || previous.className !== next.className) return false;
  const [a, b] = [previous.style ?? {}, next.style ?? {}] as Record<string, unknown>[];
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

export const KnitIcon = memo(function KnitIcon({ name, colour = "var(--icon-yarn, var(--ink))", className = "chart-icon", style }: {
  name: string;
  /** Yarn colour: hex or a token. Defaults to --icon-yarn, else ink. */
  colour?: string;
  /** Keeps the old svg's class so its CSS box (and size) holds. */
  className?: string;
  style?: CSSProperties;
}) {
  const d = THREAD_ICONS[name] ?? THREAD_ICONS[FALLBACK];
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      style={{ fill: "none", stroke: "none", overflow: "visible", ...style }}>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} style={{ stroke: tone(colour, -0.55) }} strokeWidth={WIDTH + 0.7} opacity={0.22} transform="translate(0 .6)" />
        <path d={d} style={{ stroke: colour }} strokeWidth={WIDTH} />
        <path d={d} style={{ stroke: tone(colour, -0.35) }} strokeWidth={WIDTH * 0.92} strokeDasharray="0.85 1.05" opacity={0.5} />
        <path d={d} style={{ stroke: tone(colour, 0.45) }} strokeWidth={WIDTH * 0.26} strokeDasharray="0.85 1.05" strokeDashoffset={0.95} opacity={0.55} transform="translate(-.28 -.28)" />
      </g>
    </svg>
  );
}, sameIcon);
