import { t } from "@/lib/i18n";

export interface MobileRelayConfigValue {
  enabled: boolean;
  base_url: string | null;
  invite_code: string | null;
}

export function normalizeMobileRelayConfig(
  enabled: boolean,
  rawBaseUrl: string,
  rawInviteCode: string,
): MobileRelayConfigValue {
  if (!enabled) return { enabled: false, base_url: null, invite_code: null };
  const value = rawBaseUrl.trim();
  if (!value || value.length > 2048) throw new Error(t("mobile.relayNeedUrl"));

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(t("mobile.relayInvalidUrl"));
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
  if (
    url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname !== "/"
    || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
  ) {
    throw new Error(t("mobile.relayHttpsOnly"));
  }
  const inviteCode = rawInviteCode.trim();
  if (inviteCode.length < 16 || inviteCode.length > 256 || !/^[!-~]+$/.test(inviteCode)) {
    throw new Error(t("mobile.relayInvalidInvite"));
  }
  return { enabled: true, base_url: url.origin, invite_code: inviteCode };
}
