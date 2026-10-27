"use client";

import { useState } from "react";

import { clearMapSetup } from "@/lib/map-setup";

/**
 * /privacy's "Clear my data": forgets the map setup this browser keeps (layer, Show and
 * its filters, the view, the map colours and 2D/3D), so the map opens with its defaults again.
 */
export function ClearDeviceData() {
  const [cleared, setCleared] = useState(false);
  return (
    <p className="analytics-toggle" data-testid="clear-device-data">
      <button type="button" className="chip-button" data-testid="clear-device-data-button" onClick={() => {
        clearMapSetup();
        setCleared(true);
      }}>Clear my data</button>{" "}
      <span role="status">{cleared ? "Cleared from this browser." : ""}</span>
    </p>
  );
}
