import { describe, expect, it } from "vitest";
import { sortHexaSessions, type HexaPriorityItem } from "./hexaPriority";

function item(
  id: string,
  progress_status: HexaPriorityItem["progress_status"],
  last_event_at: string,
): HexaPriorityItem {
  return { progress_status, session: { session_id: id, last_event_at } };
}

describe("sortHexaSessions", () => {
  it("puts recent live activity ahead of stale urgency", () => {
    const sorted = sortHexaSessions([
      item("completed", "completed", "2026-07-12T00:05:00Z"),
      item("working", "working", "2026-07-12T00:04:00Z"),
      item("waiting", "waiting", "2026-07-12T00:01:00Z"),
      item("idle", "idle", "2026-07-12T00:06:00Z"),
      item("stalled", "stalled", "2026-07-12T00:02:00Z"),
    ]);

    expect(sorted.map((entry) => entry.session.session_id)).toEqual([
      "idle",
      "working",
      "stalled",
      "waiting",
      "completed",
    ]);
  });

  it("uses newest activity as the tie breaker without mutating input", () => {
    const original = [
      item("older", "working", "2026-07-12T00:01:00Z"),
      item("newer", "working", "2026-07-12T00:02:00Z"),
    ];
    const sorted = sortHexaSessions(original);

    expect(sorted.map((entry) => entry.session.session_id)).toEqual(["newer", "older"]);
    expect(original.map((entry) => entry.session.session_id)).toEqual(["older", "newer"]);
  });
});
