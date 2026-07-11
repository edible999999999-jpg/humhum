export type NativeNotificationKind = "approval" | "question" | "completed" | "message";

export type NativeNotificationPreferences = Partial<Record<NativeNotificationKind, boolean>>;

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

export function shouldSendNativeNotification(
  kind: NativeNotificationKind,
  preferences?: NativeNotificationPreferences,
): boolean {
  return preferences?.[kind] !== false;
}
