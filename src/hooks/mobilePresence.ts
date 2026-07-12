export type MobilePresenceMode = "foreground" | "monitoring" | null;

export function mobilePresenceLabel(mode: MobilePresenceMode): string {
  if (mode === "foreground") return "正在使用";
  if (mode === "monitoring") return "后台监控";
  return "离线";
}
