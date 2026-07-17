package com.humhum.mobile;

import org.json.JSONException;
import org.json.JSONObject;

public final class AnywhereEnvelope {
    private final int version;
    private final long sequence;
    private final String nonce;
    private final String ciphertext;

    AnywhereEnvelope(int version, long sequence, String nonce, String ciphertext) {
        this.version = version;
        this.sequence = sequence;
        this.nonce = nonce;
        this.ciphertext = ciphertext;
    }

    public int version() { return version; }
    public long sequence() { return sequence; }
    public String nonce() { return nonce; }
    public String ciphertext() { return ciphertext; }

    public String toJson() throws JSONException {
        return new JSONObject()
                .put("version", version)
                .put("sequence", sequence)
                .put("nonce", nonce)
                .put("ciphertext", ciphertext)
                .toString();
    }
}
