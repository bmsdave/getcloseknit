/**
 * Interface themes (DESIGN.md › Themes). Two token sets live in globals.css:
 * day on :root, night under html[data-ui-theme="night"] and, while the choice
 * is "auto", under prefers-color-scheme: dark. "auto" follows the device.
 * Readers see the ids as System, Light and Dark; the ids stay as stored.
 */
export type ResolvedTheme = "day" | "night";

export interface UiTheme {
  id: "auto" | ResolvedTheme;
  label: string;
  /** Ground, panel, ink and accent, for the picker swatch. */
  swatch: readonly [string, string, string, string];
}

export const UI_THEMES: readonly UiTheme[] = [
  { id: "auto", label: "System", swatch: ["#f4f7fa", "#16203a", "#e2453c", "#f6c445"] },
  { id: "day", label: "Light", swatch: ["#f4f7fa", "#ffffff", "#22252c", "#e2453c"] },
  { id: "night", label: "Dark", swatch: ["#16203a", "#1b2540", "#f4f7fa", "#f6c445"] },
];

export const DEFAULT_UI_THEME = "auto";
export const UI_THEME_KEY = "close-knit.ui-theme";
/** Fired on window whenever the resolved theme may have changed. */
export const UI_THEME_EVENT = "close-knit:theme";

export function applyUiTheme(id: string): void {
  const root = document.documentElement;
  if (id === "day" || id === "night") root.dataset.uiTheme = id;
  else delete root.dataset.uiTheme;
  window.dispatchEvent(new Event(UI_THEME_EVENT));
}

/** The theme actually showing: an explicit choice, else the device setting. */
export function resolvedUiTheme(): ResolvedTheme {
  if (typeof document === "undefined") return "day";
  const chosen = document.documentElement.dataset.uiTheme;
  if (chosen === "day" || chosen === "night") return chosen;
  return systemUiTheme();
}

/** The device setting, which "auto" (System) follows. */
export function systemUiTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "day";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "night" : "day";
}

/** Calls back whenever the resolved theme may have changed: a new choice, or the device going dark under "auto". */
export function onUiThemeChange(callback: () => void): () => void {
  const query = window.matchMedia?.("(prefers-color-scheme: dark)");
  window.addEventListener(UI_THEME_EVENT, callback);
  query?.addEventListener?.("change", callback);
  return () => {
    window.removeEventListener(UI_THEME_EVENT, callback);
    query?.removeEventListener?.("change", callback);
  };
}

/**
 * Inline <head> script: apply the saved choice before first paint so a night
 * reader never sees a flash of day. Kept tiny and dependency-free.
 */
export const UI_THEME_BOOT = `try{var t=localStorage.getItem(${JSON.stringify(UI_THEME_KEY)});if(t==="day"||t==="night")document.documentElement.dataset.uiTheme=t}catch(e){}`;
