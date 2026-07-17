package com.humhum.mobile;

import org.json.JSONException;
import org.json.JSONObject;

public final class PairingSetup {
    private final String rawSource;
    private final String url;
    private final String code;
    private final String fingerprint;
    private final Models.Scope scope;
    private final long expiresAt;
    private final Models.WakeRelayConfig pairingRelay;

    private PairingSetup(
            String rawSource,
            String url,
            String code,
            String fingerprint,
            Models.Scope scope,
            long expiresAt,
            Models.WakeRelayConfig pairingRelay) {
        this.rawSource = rawSource;
        this.url = url;
        this.code = code;
        this.fingerprint = fingerprint;
        this.scope = scope;
        this.expiresAt = expiresAt;
        this.pairingRelay = pairingRelay;
    }

    public static PairingSetup parse(String source) {
        return parse(source, host -> false);
    }

    public static PairingSetup parse(String source, BridgeConfig.HostPolicy hostPolicy) {
        try {
            String rawSource = source == null ? "" : source.trim();
            JSONObject value = new JSONObject(rawSource);
            int version = value.optInt("version", -1);
            if (version != 1 && version != 2) {
                throw new IllegalArgumentException("不支持的 HUMHUM 配对资料版本");
            }
            BridgeConfig config = BridgeConfig.parse(
                    value.optString("url"),
                    value.optString("code"),
                    value.optString("fingerprint"),
                    "Xiaomi Android",
                    version == 2 ? host -> true : hostPolicy);
            long expiresAt = 0;
            Models.WakeRelayConfig pairingRelay = null;
            if (version == 1) {
                if (value.length() != 5) {
                    throw new IllegalArgumentException("HUMHUM 配对资料格式无效");
                }
            } else {
                Object rawExpiry = value.get("expires_at");
                if (value.length() != 7
                        || (!(rawExpiry instanceof Integer) && !(rawExpiry instanceof Long))
                        || ((Number) rawExpiry).longValue() <= 0
                        || !(value.get("pairing_relay") instanceof JSONObject)) {
                    throw new IllegalArgumentException("HUMHUM 远程配对资料格式无效");
                }
                expiresAt = ((Number) rawExpiry).longValue();
                pairingRelay = MobileProtocol.parseWakeRelay(
                        value.getJSONObject("pairing_relay"));
                if (pairingRelay.version() != 2) {
                    throw new IllegalArgumentException("HUMHUM 远程配对通道无效");
                }
            }
            return new PairingSetup(
                    rawSource,
                    config.baseUrl(),
                    config.pairingCode(),
                    config.fingerprint(),
                    Models.Scope.fromWire(value.optString("scope")),
                    expiresAt,
                    pairingRelay);
        } catch (JSONException error) {
            throw new IllegalArgumentException("剪贴板里没有有效的 HUMHUM 配对资料", error);
        }
    }

    public String url() { return url; }
    public String code() { return code; }
    public String fingerprint() { return fingerprint; }
    public Models.Scope scope() { return scope; }
    public boolean canPairRemotely() { return pairingRelay != null; }
    public long expiresAt() { return expiresAt; }
    public Models.WakeRelayConfig pairingRelay() { return pairingRelay; }
    String rawSource() { return rawSource; }
}
