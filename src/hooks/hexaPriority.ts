export interface HexaPriorityItem {
  progress_status: "working" | "waiting" | "looping" | "stalled" | "idle" | "completed";
  session: {
    session_id: string;
    last_event_at: string;
  };
}

const PRIORITY: Record<HexaPriorityItem["progress_status"], number> = {
  waiting: 0,
  looping: 1,
  stalled: 1,
  working: 2,
  idle: 3,
  completed: 4,
};

export function sortHexaSessions<T extends HexaPriorityItem>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => {
    const urgency = PRIORITY[left.progress_status] - PRIORITY[right.progress_status];
    if (urgency !== 0) return urgency;
    return new Date(right.session.last_event_at).getTime() - new Date(left.session.last_event_at).getTime();
  });
}
