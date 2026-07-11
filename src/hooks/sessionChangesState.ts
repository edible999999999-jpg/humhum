export interface GitChangedFile {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "conflicted" | "untracked";
  staged: boolean;
  insertions: number;
  deletions: number;
  binary: boolean;
}

export interface GitChangeSummary {
  branch: string | null;
  total_files: number;
  truncated: boolean;
  files: GitChangedFile[];
}

export interface SessionChangesState {
  open: boolean;
  status: "idle" | "loading" | "ready" | "error";
  summary: GitChangeSummary | null;
  error: string | null;
}

export type SessionChangesAction =
  | { type: "open" }
  | { type: "close" }
  | { type: "load" }
  | { type: "success"; summary: GitChangeSummary }
  | { type: "failure"; error: string };

export const initialSessionChangesState: SessionChangesState = {
  open: false,
  status: "idle",
  summary: null,
  error: null,
};

export function sessionChangesReducer(
  state: SessionChangesState,
  action: SessionChangesAction,
): SessionChangesState {
  switch (action.type) {
    case "open":
      return { ...state, open: true };
    case "close":
      return { ...state, open: false };
    case "load":
      return { ...state, open: true, status: "loading", error: null };
    case "success":
      return { ...state, status: "ready", summary: action.summary, error: null };
    case "failure":
      return { ...state, status: "error", error: action.error };
  }
}
