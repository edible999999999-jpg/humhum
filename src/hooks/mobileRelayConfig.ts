export interface MobileRelayConfigValue {
  enabled: boolean;
  base_url: string | null;
}

export function normalizeMobileRelayConfig(
  enabled: boolean,
  rawBaseUrl: string,
): MobileRelayConfigValue {
  if (!enabled) return { enabled: false, base_url: null };
  const value = rawBaseUrl.trim();
  if (!value || value.length > 2048) throw new Error("请输入加密唤醒中继 URL");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("加密唤醒中继 URL 无效");
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
    throw new Error("公网中继必须使用 HTTPS，且 URL 不能包含账号、路径或参数");
  }
  return { enabled: true, base_url: url.origin };
}
