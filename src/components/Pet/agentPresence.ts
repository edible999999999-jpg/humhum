import type { HookEvent } from "@/types";

const PASSIVE_EVENT_NAMES = new Set(["TranscriptBackfill"]);

export interface SessionPresence {
  client_type: string;
  event_names?: string[];
}

export function isPetPresenceEvent(event: HookEvent): boolean {
  if (!event.client_type) return false;
  if (PASSIVE_EVENT_NAMES.has(event.hook_event_name)) return false;
  return true;
}

export function activeClientTypesFromSessions(sessions: SessionPresence[]): string[] {
  const clients = sessions
    .filter((session) => {
      const names = session.event_names ?? [];
      return names.length === 0 || names.some((name) => !PASSIVE_EVENT_NAMES.has(name));
    })
    .map((session) => session.client_type);

  return [...new Set(clients)];
}
