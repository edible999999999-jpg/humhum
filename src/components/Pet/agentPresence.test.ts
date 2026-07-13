import { describe, expect, it } from "vitest";
import { activeClientTypesFromSessions, isPetPresenceEvent } from "./agentPresence";
import type { HookEvent } from "@/types";

function event(name: string, client = "openclaw"): HookEvent {
  return {
    id: "event-1",
    hook_event_name: name as HookEvent["hook_event_name"],
    session_id: "session-1",
    client_type: client,
    payload: {},
    timestamp: "2026-07-13T00:00:00Z",
  };
}

describe("agentPresence", () => {
  it("does not promote transcript backfill into the pet presence badge", () => {
    expect(isPetPresenceEvent(event("TranscriptBackfill"))).toBe(false);
  });

  it("promotes realtime hook events into the pet presence badge", () => {
    expect(isPetPresenceEvent(event("PostToolUse", "codex"))).toBe(true);
  });

  it("filters sessions that only contain passive backfill events", () => {
    expect(
      activeClientTypesFromSessions([
        { client_type: "openclaw", event_names: ["TranscriptBackfill"] },
        { client_type: "codex", event_names: ["PreToolUse", "PostToolUse"] },
      ]),
    ).toEqual(["codex"]);
  });
});
