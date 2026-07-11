export type InterventionProvider = "codex" | "claude" | "opencode";

export function interventionProviderForClient(clientType: string): InterventionProvider | null {
  if (clientType === "codex") return "codex";
  if (clientType === "claude-code") return "claude";
  if (clientType === "opencode") return "opencode";
  return null;
}

export function interventionMatches(
  intervention: { thread_id: string; provider?: InterventionProvider },
  provider: InterventionProvider,
  threadId: string,
): boolean {
  return intervention.thread_id === threadId && (intervention.provider ?? "codex") === provider;
}
