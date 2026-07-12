package com.humhum.mobile;

import org.json.JSONException;
import org.json.JSONObject;

public final class PairingSetup {
    private final String url;
    private final String code;
    private final String fingerprint;
    private final Models.Scope scope;

    private PairingSetup(String url, String code, String fingerprint, Models.Scope scope) {
        this.url = url;
        this.code = code;
        this.fingerprint = fingerprint;
        this.scope = scope;
    }

    public static PairingSetup parse(String source) {
        try {
            JSONObject value = new JSONObject(source == null ? "" : source.trim());
            if (value.optInt("version", -1) != 1) {
                throw new IllegalArgumentException("不支持的 HUMHUM 配对资料版本");
            }
            BridgeConfig config = BridgeConfig.parse(
                    value.optString("url"),
                    value.optString("code"),
                    value.optString("fingerprint"),
                    "Xiaomi Android");
            return new PairingSetup(
                    config.baseUrl(),
                    config.pairingCode(),
                    config.fingerprint(),
                    Models.Scope.fromWire(value.optString("scope")));
        } catch (JSONException error) {
            throw new IllegalArgumentException("剪贴板里没有有效的 HUMHUM 配对资料", error);
        }
    }

    public String url() { return url; }
    public String code() { return code; }
    public String fingerprint() { return fingerprint; }
    public Models.Scope scope() { return scope; }
}
