import type { PreferenceProfile } from "./contracts";
import { criterionId } from "./match-model";
import { removeCriterion, searchCriteria } from "./match-search";

/**
 * My match's rows (board "My match · Your order rows"): which criterion is open (one at a time, its body in the row)
 * and the search itself. Pure, so the list's clicks and the toast's Undo share one tested path.
 */
export interface RowsState {
  profile: PreferenceProfile;
  open: string | null;
}

export type RowsAction =
  /** The row's header: opens it, or closes it when it is the open one. */
  | { type: "toggle"; id: string }
  | { type: "close" }
  /** The row's ×: the criterion leaves the search (its body closes with it). */
  | { type: "remove"; id: string }
  /** Undo in the toast: the search as it was. */
  | { type: "restore"; profile: PreferenceProfile };

export function rowsReducer(state: RowsState, action: RowsAction): RowsState {
  switch (action.type) {
    case "toggle":
      return { ...state, open: state.open === action.id ? null : action.id };
    case "close":
      return state.open === null ? state : { ...state, open: null };
    case "remove": {
      if (!searchCriteria(state.profile).some((item) => criterionId(item) === action.id)) return state;
      return { profile: removeCriterion(state.profile, action.id), open: state.open === action.id ? null : state.open };
    }
    case "restore":
      return { ...state, profile: action.profile };
  }
}
