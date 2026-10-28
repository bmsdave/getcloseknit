import { CloseKnit } from "./close-knit";
import type { MapState } from "@/lib/map-state";

export function ExplorerPage({ initialState, link, fitSelected = false, fitZoom = null, dev = false }: {
  initialState: MapState;
  /** The query the page was opened with, as the server read it. */
  link?: string;
  fitSelected?: boolean;
  /** The zoom a fitted link asks for: the area centred at it rather than its whole box. */
  fitZoom?: number | null;
  dev?: boolean;
}) {
  return <CloseKnit initialState={initialState} link={link} fitSelected={fitSelected} fitZoom={fitZoom} dev={dev} />;
}
