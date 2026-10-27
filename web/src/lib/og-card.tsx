/**
 * Link-preview cards (app/opengraph-image.tsx and the area and explore cards), drawn by next/og.
 * DESIGN.md: clean snow ground (--paper), ink text, the knitted-house logo (public/icon.svg, made by
 * scripts/knit-icon.tsx) with the lowercase wordmark, one family (Bricolage Grotesque, OFL: next/og
 * reads no woff2 or variable fonts, so public/og holds static TTF instances of app/fonts' file, made
 * with fontTools' instancer at wght 500/opsz 18 and wght 800/opsz 72) and a band of the yarn box.
 * No textures. A card off real data says so on it.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const CARD_SIZE = { width: 1200, height: 630 } as const;
export const CARD_TYPE = "image/png";
export const DEMO_LABEL = "Demo data · not for decisions";

// Day tokens (globals.css :root) and the yarn box: a card is a picture, it has no theme.
const PAPER = "#f4f7fa";
const INK = "#22252c";
const MUTED = "#5b6270";
const PRIMARY = "#c0352c";
const ACCENT = "#f6c445";
const YARN = ["#e2453c", "#f6c445", "#f28b30", "#4aa3df", "#2f5bd3", "#f08bb0"];

export interface CardInput {
  /** Small line above the title ("Area", "Explore"). */
  eyebrow: string;
  title: string;
  /** The headline figure ("£9,850 per m²") and what sits beside it ("+12.3% in 5 years"). */
  figure?: string | null;
  aside?: string | null;
  /** Up to three short lines under the figure (a top-3 list). */
  lines?: readonly string[];
  /** Source and date, always shown. */
  source: string;
  /** Not real data: the demo label is baked into the card. */
  demo: boolean;
}

let assets: Promise<{ logo: string; regular: Buffer; bold: Buffer }> | null = null;

function loadAssets() {
  // public/ ships next to the standalone server (web/Dockerfile), so it is there at run time.
  assets ??= Promise.all([
    readFile(join(process.cwd(), "public/icon.svg"), "base64"),
    readFile(join(process.cwd(), "public/og/BricolageGrotesque-500.ttf")),
    readFile(join(process.cwd(), "public/og/BricolageGrotesque-800.ttf")),
  ]).then(([logo, regular, bold]) => ({ logo: `data:image/svg+xml;base64,${logo}`, regular, bold }));
  return assets;
}

export async function renderCard(input: CardInput): Promise<ImageResponse> {
  const { logo, regular, bold } = await loadAssets();
  const titleSize = input.title.length > 34 ? 60 : 76;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: PAPER, color: INK, fontFamily: "Bricolage" }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "56px 72px 40px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
              <img src={logo} width={84} height={84} />
              <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.03em" }}>close knit</span>
            </div>
            {input.demo && (
              <span style={{ display: "flex", background: ACCENT, color: INK, fontSize: 26, fontWeight: 800, padding: "10px 22px", borderRadius: 999 }}>
                {DEMO_LABEL}
              </span>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 44 }}>
            <span style={{ fontSize: 28, fontWeight: 500, color: MUTED }}>{input.eyebrow}</span>
            <span style={{ fontSize: titleSize, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.05, marginTop: 8 }}>{input.title}</span>
          </div>
          {(input.figure || input.aside) && (
            <div style={{ display: "flex", alignItems: "baseline", gap: 24, marginTop: 28 }}>
              {input.figure && <span style={{ fontSize: 56, fontWeight: 800, color: PRIMARY, letterSpacing: "-0.02em" }}>{input.figure}</span>}
              {input.aside && <span style={{ fontSize: 32, fontWeight: 500, color: INK }}>{input.aside}</span>}
            </div>
          )}
          {input.lines && input.lines.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", marginTop: 22, gap: 6 }}>
              {input.lines.slice(0, 3).map((line, index) => (
                <span key={line} style={{ fontSize: 32, fontWeight: 500 }}>{`${index + 1}. ${line}`}</span>
              ))}
            </div>
          )}
          <span style={{ marginTop: "auto", fontSize: 24, fontWeight: 500, color: MUTED }}>{input.source}</span>
        </div>
        <div style={{ display: "flex", height: 18 }}>
          {YARN.map((colour) => <div key={colour} style={{ flex: 1, background: colour }} />)}
        </div>
      </div>
    ),
    {
      ...CARD_SIZE,
      fonts: [
        { name: "Bricolage", data: regular, weight: 500, style: "normal" },
        { name: "Bricolage", data: bold, weight: 800, style: "normal" },
      ],
      // A card follows the data release, not each request.
      headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
    },
  );
}

/** "Not found" for an unknown or hidden area or lens: the card 404s like its page. */
export function cardNotFound(): Response {
  return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
