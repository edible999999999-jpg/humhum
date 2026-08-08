import { t } from "@/lib/i18n";

export type HexaPlanningCapability = "native" | "reported" | "inferred" | "unavailable";
export type HexaWorkItemSource = "native_plan" | "agent_report" | "hexa_inferred" | "user" | "legacy_migration";

export function planningCapabilityCopy(capability: HexaPlanningCapability = "inferred") {
  switch (capability) {
    case "native":
      return { label: t("hexa.capNativeLabel"), detail: t("hexa.capNativeDetail"), tone: "good" as const };
    case "reported":
      return { label: t("hexa.capReportLabel"), detail: t("hexa.capReportDetail"), tone: "good" as const };
    case "inferred":
      return { label: t("hexa.capInferredLabel"), detail: t("hexa.capInferredDetail"), tone: "watch" as const };
    case "unavailable":
      return { label: t("hexa.capNoneLabel"), detail: t("hexa.capNoneDetail"), tone: "watch" as const };
  }
}

export function workItemSourceLabel(source: HexaWorkItemSource = "agent_report"): string {
  return {
    native_plan: t("hexa.capSourceNative"),
    agent_report: t("hexa.capSourceReport"),
    hexa_inferred: t("hexa.capSourceInferred"),
    user: t("hexa.capSourceUser"),
    legacy_migration: t("hexa.capSourceLegacy"),
  }[source];
}

const WATCHED_SESSION_EXPIRY_MS = 30 * 60 * 1000;

export function watchedSessionIsExpired(
  status: string,
  updatedAt: string,
  now = Date.now(),
): boolean {
  if (!new Set(["starting", "working", "waiting", "blocked"]).has(status)) return false;
  const updated = new Date(updatedAt).getTime();
  return !Number.isFinite(updated) || now - updated > WATCHED_SESSION_EXPIRY_MS;
}

export function watchedSessionConnectionLabel(
  status: string,
  updatedAt: string,
  now = Date.now(),
): string | null {
  return watchedSessionIsExpired(status, updatedAt, now) ? t("hexa.disconnected") : null;
}

export function watchedSessionAge(value: string, now = Date.now()): string {
  const updated = new Date(value).getTime();
  if (!Number.isFinite(updated)) return t("hexa.timeUnknown");
  const minutes = Math.max(0, Math.floor((now - updated) / 60_000));
  if (minutes < 1) return t("hexa.timeJust");
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
