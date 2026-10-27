/**
 * The compass chip (Map controls PR 1): a round chip above my location that shows only while the map is
 * turned or tilted, and puts the map back to north and flat with one tap.
 */

export interface CompassCamera {
  bearing: number;
  pitch: number;
}

/** After the chip is tapped it stays for this long, so a tap never lands on a vanishing button. */
export const COMPASS_HIDE_MS = 600;

/** How long the map takes to come back to north and flat. */
export const COMPASS_EASE_MS = 300;

/**
 * Whether the chip shows: the settled camera (after MapLibre's 7° bearing snap) is turned or tilted,
 * or the map is still easing back after a tap (`resetting`).
 */
export function compassShown(camera: CompassCamera, resetting = false): boolean {
  return resetting || Math.abs(camera.bearing) > 0.01 || camera.pitch > 0.01;
}

/** The needle's rotation on the chip: the map's bearing undone, so its north half points where north is. */
export function needleAngle(bearing: number): number {
  return bearing === 0 ? 0 : -bearing;
}
