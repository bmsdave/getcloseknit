"use client";

import { useEffect, useState } from "react";

import { applyUiTheme, DEFAULT_UI_THEME, UI_THEME_KEY, UI_THEMES } from "@/lib/ui-themes";

/** Theme buttons for the chart demo; shares the app's saved theme. */
export function ThemeSwitch() {
  const [theme, setTheme] = useState(DEFAULT_UI_THEME);
  useEffect(() => {
    let saved = DEFAULT_UI_THEME;
    try { saved = window.localStorage.getItem(UI_THEME_KEY) ?? DEFAULT_UI_THEME; } catch { /* storage blocked */ }
    applyUiTheme(saved);
    setTheme(saved);
  }, []);
  const pick = (id: string) => {
    applyUiTheme(id);
    setTheme(id);
    try { window.localStorage.setItem(UI_THEME_KEY, id); } catch { /* storage blocked */ }
  };
  return (
    <div className="dev-charts__themes" role="group" aria-label="Theme">
      {UI_THEMES.map((option) => (
        <button key={option.id} type="button" aria-pressed={theme === option.id} onClick={() => pick(option.id)}>{option.label}</button>
      ))}
    </div>
  );
}
