import { t } from "@/lib/i18n";

export type MobilePresenceMode = "foreground" | "monitoring" | null;

export function mobilePresenceLabel(mode: MobilePresenceMode): string {
  if (mode === "foreground") return t("mobile.presenceForeground");
  if (mode === "monitoring") return t("mobile.presenceMonitoring");
  return t("mobile.presenceOffline");
}
