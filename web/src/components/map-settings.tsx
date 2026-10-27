"use client";

import { paletteById, paletteRamp, sampleRamp } from "@/lib/palettes";

import { AppearanceOptions } from "./appearance-menu";
import { KnitIcon } from "./knit/knit-icon";
import { SwatchKnit } from "./ramp-knit";
import { useDisclosure } from "./top-bar-menu";

/**
 * The map's rows in the ≡ menu: "Map" with [2D | 3D], and
 * "Colours" with the current palette's swatches, opening the list in place.
 * The theme row follows them in the menu's settings block (site-menu.tsx).
 */
export function MapSettings(props: {
  themeId: string;
  onTheme: (id: string) => void;
  paletteId: string;
  onPalette: (id: string) => void;
  /** The layer shown: the palette swatches show what they paint on it. */
  layer: string;
  pitch: number;
  onPitch: (pitch: number) => void;
  /** False in the ≡ menu, whose settings block has the theme already. */
  showTheme?: boolean;
}) {
  const colours = useDisclosure();
  const current = paletteById(props.paletteId);
  return (
    <>
      <div className="menu-row map-view">
        <span className="menu-row__label" id="map-view-label">Map</span>
        <div className="menu-seg" role="group" aria-labelledby="map-view-label">
          <button type="button" aria-label="Flatten map" aria-pressed={props.pitch === 0} onClick={() => props.onPitch(0)}>2D</button>
          <button type="button" aria-label="Tilt map" aria-pressed={props.pitch !== 0} onClick={() => props.onPitch(45)}>3D</button>
        </div>
      </div>
      <div className="menu-colours" ref={colours.wrap}>
        <button {...colours.buttonProps} aria-controls="appearance-menu" className="menu-row menu-row--button" data-testid="appearance-toggle">
          <span className="menu-row__label">Colours</span>
          <span className="appearance-swatch" aria-hidden="true"><SwatchKnit colours={sampleRamp(paletteRamp(current, props.layer), 4)} /></span>
          <KnitIcon name="chevron-down" colour="var(--icon-yarn, currentColor)" className="top-menu-caret" style={{ width: 14, height: 14 }} />
        </button>
        {colours.open && (
          <AppearanceOptions themeId={props.themeId} onTheme={props.onTheme} paletteId={props.paletteId} onPalette={props.onPalette} layer={props.layer} showTheme={props.showTheme} />
        )}
      </div>
    </>
  );
}

/** Sliders: the map settings, knitted. */
export function SettingsIcon() {
  return <KnitIcon name="settings" colour="var(--icon-yarn, currentColor)" className="icon-settings" style={{ width: 18, height: 18 }} />;
}
