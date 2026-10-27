"use client";

import { useEffect, useState } from "react";

import { paletteRamp, PALETTES, sampleRamp } from "@/lib/palettes";
import { DEFAULT_UI_THEME, UI_THEMES, UI_THEME_KEY, applyUiTheme, onUiThemeChange, systemUiTheme, type ResolvedTheme } from "@/lib/ui-themes";

import { SwatchKnit } from "./ramp-knit";

/** The interface theme kept in this browser; applied on mount. */
export function useUiTheme() {
  const [themeId, setThemeId] = useState(DEFAULT_UI_THEME);
  useEffect(() => {
    let saved = DEFAULT_UI_THEME;
    try { saved = window.localStorage.getItem(UI_THEME_KEY) ?? DEFAULT_UI_THEME; } catch { /* storage blocked */ }
    setThemeId(saved);
    applyUiTheme(saved);
  }, []);
  function chooseTheme(id: string) {
    setThemeId(id);
    applyUiTheme(id);
    try { window.localStorage.setItem(UI_THEME_KEY, id); } catch { /* storage blocked */ }
  }
  return { themeId, chooseTheme };
}

/** The device's light or dark setting, kept live: what System shows. */
function useSystemUiTheme(): ResolvedTheme {
  const [system, setSystem] = useState<ResolvedTheme>("day");
  useEffect(() => {
    const update = () => setSystem(systemUiTheme());
    update();
    return onUiThemeChange(update);
  }, []);
  return system;
}

/**
 * Interface theme and map colours: the Colours section of the top-bar menu. Each palette's swatch is
 * what it paints on the layer shown (the default runs blue to red on crime, the traffic light green to red).
 */
export function AppearanceOptions({ themeId, onTheme, paletteId, onPalette, layer, showTheme = true }: {
  themeId: string;
  onTheme: (id: string) => void;
  paletteId: string;
  onPalette: (id: string) => void;
  layer: string;
  /** False in the ≡ menu, whose foot has the theme already. */
  showTheme?: boolean;
}) {
  const system = useSystemUiTheme();
  return (
    <div className="appearance-menu" id="appearance-menu" data-testid="appearance-menu">
      {showTheme && <fieldset className="theme-choice" role="radiogroup" aria-label="Theme">
        <legend>Theme</legend>
        {UI_THEMES.map((theme) => (
          <label key={theme.id}>
            <input type="radio" name="ui-theme" value={theme.id} checked={themeId === theme.id} onChange={() => onTheme(theme.id)} />
            <span className="appearance-swatch" aria-hidden="true"><SwatchKnit colours={theme.swatch} /></span>
            {theme.id === "auto" ? `${theme.label} (${system === "night" ? "Dark" : "Light"})` : theme.label}
          </label>
        ))}
      </fieldset>}
      <fieldset>
        {/* In the ≡ menu the Colours row above names the list. */}
        <legend className={showTheme ? undefined : "sr-only"}>Map colours</legend>
        {PALETTES.map((palette) => (
          <button key={palette.id} type="button" aria-pressed={paletteId === palette.id} onClick={() => onPalette(palette.id)}>
            <span className="appearance-menu__label">{palette.label}</span>
            <span className="appearance-swatch" aria-hidden="true">
              <SwatchKnit colours={sampleRamp(paletteRamp(palette, layer), 4)} />
            </span>
          </button>
        ))}
      </fieldset>
    </div>
  );
}
