import { describe, expect, it } from "vitest";
import { initialSessionChangesState, sessionChangesReducer } from "./sessionChangesState";

describe("sessionChangesReducer", () => {
  it("keeps an explicit loading and success lifecycle", () => {
    const opened = sessionChangesReducer(initialSessionChangesState, { type: "open" });
    const loading = sessionChangesReducer(opened, { type: "load" });
    const ready = sessionChangesReducer(loading, {
      type: "success",
      summary: { branch: "main", total_files: 0, truncated: false, files: [] },
    });

    expect(opened.open).toBe(true);
    expect(loading.status).toBe("loading");
    expect(ready.status).toBe("ready");
    expect(ready.summary?.files).toEqual([]);
  });

  it("keeps failures retryable and closes without losing the loaded summary", () => {
    const failed = sessionChangesReducer(
      { ...initialSessionChangesState, open: true, status: "loading" },
      { type: "failure", error: "not a repository" },
    );
    const closed = sessionChangesReducer(
      {
        ...failed,
        status: "ready",
        summary: { branch: null, total_files: 1, truncated: false, files: [] },
      },
      { type: "close" },
    );

    expect(failed.status).toBe("error");
    expect(failed.error).toBe("not a repository");
    expect(closed.open).toBe(false);
    expect(closed.summary?.total_files).toBe(1);
  });
});
