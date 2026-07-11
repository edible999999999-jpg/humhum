export interface InterventionState {
  status: "idle" | "sending" | "queued" | "delivered" | "failed";
  draft: string;
  error: string | null;
}

export type InterventionAction =
  | { type: "draft"; value: string }
  | { type: "send" }
  | { type: "queued" }
  | { type: "delivered" }
  | { type: "failed"; error: string };

export const initialInterventionState: InterventionState = {
  status: "idle",
  draft: "",
  error: null,
};

export function interventionReducer(
  state: InterventionState,
  action: InterventionAction,
): InterventionState {
  switch (action.type) {
    case "draft":
      return { status: "idle", draft: action.value, error: null };
    case "send":
      return state.draft.trim()
        ? { ...state, status: "sending", error: null }
        : state;
    case "delivered":
      return { status: "delivered", draft: "", error: null };
    case "queued":
      return { status: "queued", draft: "", error: null };
    case "failed":
      return { ...state, status: "failed", error: action.error };
  }
}
