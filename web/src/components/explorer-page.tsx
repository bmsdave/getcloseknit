import { CloseKnit } from "./close-knit";
import type { MapState } from "@/lib/map-state";

export function ExplorerPage({ initialState, link, fitSelected = false, dev = false }: {
  initialState: MapState;
  /** The query the page was opened with, as the server read it. */
  link?: string;
  fitSelected?: boolean;
  dev?: boolean;
}) {
  return <CloseKnit initialState={initialState} link={link} fitSelected={fitSelected} dev={dev} />;
}
