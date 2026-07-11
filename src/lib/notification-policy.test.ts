import { describe, expect, it } from "vitest";
import { nativeNotificationKind, shouldSendNativeNotification } from "./notification-policy";

describe("nativeNotificationKind", () => {
  it("notifies only for events that need attention or report completion", () => {
    expect(nativeNotificationKind("PermissionRequest", "Bash")).toBe("approval");
    expect(nativeNotificationKind("PreToolUse", "AskUserQuestion")).toBe("question");
    expect(nativeNotificationKind("TaskCompleted", null)).toBe("completed");
    expect(nativeNotificationKind("Stop", null)).toBe("completed");
    expect(nativeNotificationKind("Notification", null)).toBe("message");
  });

  it("does not interrupt for ordinary tool progress", () => {
    expect(nativeNotificationKind("PreToolUse", "Bash")).toBeNull();
    expect(nativeNotificationKind("PostToolUse", "Bash")).toBeNull();
  });

  it("honors each native notification preference independently", () => {
    expect(shouldSendNativeNotification("approval", undefined)).toBe(true);
    expect(shouldSendNativeNotification("approval", { approval: false })).toBe(false);
    expect(shouldSendNativeNotification("completed", { approval: false })).toBe(true);
    expect(shouldSendNativeNotification("message", { message: false })).toBe(false);
  });
});
