export type NativeNotificationKind = "approval" | "question" | "completed" | "message";

export function nativeNotificationKind(
  eventName: string,
  toolName: string | null,
): NativeNotificationKind | null {
  if (eventName === "PermissionRequest" && toolName !== "AskUserQuestion") return "approval";
  if (eventName === "PreToolUse" && toolName === "AskUserQuestion") return "question";
  if (eventName === "TaskCompleted" || eventName === "Stop") return "completed";
  if (eventName === "Notification") return "message";
  return null;
}
