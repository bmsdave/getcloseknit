"use client";

import { useEffect, useState } from "react";

import { currentMode, setAnalyticsEnabled, type AnalyticsMode } from "@/lib/usage";

/** /privacy's simple way to object to usage analytics (lib/usage.ts): one switch, remembered in this browser. */
export function AnalyticsToggle() {
  const [mode, setMode] = useState<AnalyticsMode | null>(null);
  const [blockedByBrowser, setBlockedByBrowser] = useState(false);
  useEffect(() => {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    setBlockedByBrowser(nav.globalPrivacyControl === true || nav.doNotTrack === "1");
    setMode(currentMode());
  }, []);
  if (mode === null) return null;
  if (blockedByBrowser) {
    return <p data-testid="analytics-status">Your browser asks sites not to track it (Global Privacy Control or Do Not Track), so nothing is sent.</p>;
  }
  const on = mode !== "off";
  const flip = () => {
    setAnalyticsEnabled(!on);
    setMode(currentMode());
  };
  return (
    <p className="analytics-toggle" data-testid="analytics-status">
      <button type="button" className="chip-button" role="switch" aria-checked={on} onClick={flip} data-testid="analytics-toggle">
        Analytics {on ? "on" : "off"}
      </button>{" "}
      {mode === "counted" && "Counted with a random id in this browser. Turn it off to stop sending anything."}
      {mode === "anonymous" && "Counted without an id (your browser is in an EU or EEA time zone)."}
      {mode === "off" && "Nothing is sent from this browser."}
    </p>
  );
}
