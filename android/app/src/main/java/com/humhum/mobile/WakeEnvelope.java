package com.humhum.mobile;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.json.JSONException;
import org.json.JSONObject;

public final class WakeEnvelope {
    private static final long MAX_CLOCK_SKEW_SECONDS = 600;

    private WakeEnvelope() {}

    public static WakeSignal decrypt(
            String keyHex,
            String channel,
            long expectedAfter,
            String rawEnvelope,
            long nowSeconds) throws GeneralSecurityException, JSONException {
        byte[] key = decodeHex(keyHex, 32);
        decodeHex(channel, 32);
        JSONObject envelope = new JSONObject(rawEnvelope);
        if (envelope.length() != 4
                || !envelope.has("version")
                || !envelope.has("sequence")
                || !envelope.has("nonce")
                || !envelope.has("ciphertext")
                || strictLong(envelope, "version") != 1) {
            throw new GeneralSecurityException("Wake envelope is invalid");
        }
        long sequence = strictLong(envelope, "sequence");
        if (sequence <= expectedAfter) {
            throw new GeneralSecurityException("Wake sequence is invalid");
        }
        String nonceText = envelope.getString("nonce");
        String ciphertextText = envelope.getString("ciphertext");
        if (nonceText.length() != 16
                || ciphertextText.isEmpty()
                || ciphertextText.length() > 4_096) {
            throw new GeneralSecurityException("Wake envelope is invalid");
        }
        byte[] nonce = decodeBase64Url(nonceText, 12);
        byte[] ciphertext = decodeBase64Url(ciphertextText, -1);
        if (ciphertext.length < 16) {
            throw new GeneralSecurityException("Wake ciphertext is invalid");
        }

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(
                Cipher.DECRYPT_MODE,
                new SecretKeySpec(key, "AES"),
                new GCMParameterSpec(128, nonce));
        cipher.updateAAD(aad(channel, sequence).getBytes(StandardCharsets.UTF_8));
        byte[] plaintext = cipher.doFinal(ciphertext);
        if (plaintext.length > 256) {
            throw new GeneralSecurityException("Wake plaintext is invalid");
        }
        JSONObject signal = new JSONObject(new String(plaintext, StandardCharsets.UTF_8));
        if (signal.length() != 2
                || !"wake".equals(signal.getString("kind"))
                || !signal.has("issued_at")) {
            throw new GeneralSecurityException("Wake plaintext is invalid");
        }
        long issuedAt = strictLong(signal, "issued_at");
        long delta;
        try {
            delta = Math.subtractExact(nowSeconds, issuedAt);
        } catch (ArithmeticException error) {
            throw new GeneralSecurityException("Wake timestamp is invalid", error);
        }
        if (issuedAt <= 0
                || nowSeconds <= 0
                || delta < -MAX_CLOCK_SKEW_SECONDS
                || delta > MAX_CLOCK_SKEW_SECONDS) {
            throw new GeneralSecurityException("Wake timestamp is invalid");
        }
        return new WakeSignal("wake", issuedAt, sequence);
    }

    private static String aad(String channel, long sequence) {
        if (sequence <= 0) throw new IllegalArgumentException("Wake sequence is invalid");
        return "humhum-wake-v1:" + channel + ":" + sequence;
    }

    private static long strictLong(JSONObject value, String key)
            throws JSONException, GeneralSecurityException {
        Object number = value.get(key);
        if (!(number instanceof Integer) && !(number instanceof Long)) {
            throw new GeneralSecurityException("Wake numeric field is invalid");
        }
        return ((Number) number).longValue();
    }

    private static byte[] decodeHex(String value, int expectedBytes)
            throws GeneralSecurityException {
        if (value == null || !value.matches("[a-f0-9]{" + (expectedBytes * 2) + "}")) {
            throw new GeneralSecurityException("Wake configuration is invalid");
        }
        byte[] decoded = new byte[expectedBytes];
        for (int index = 0; index < expectedBytes; index++) {
            decoded[index] = (byte) Integer.parseInt(value.substring(index * 2, index * 2 + 2), 16);
        }
        return decoded;
    }

    private static byte[] decodeBase64Url(String value, int expectedBytes)
            throws GeneralSecurityException {
        try {
            byte[] decoded = Base64.getUrlDecoder().decode(value);
            if ((expectedBytes >= 0 && decoded.length != expectedBytes)
                    || !Base64.getUrlEncoder().withoutPadding().encodeToString(decoded).equals(value)) {
                throw new GeneralSecurityException("Wake envelope encoding is invalid");
            }
            return decoded;
        } catch (IllegalArgumentException error) {
            throw new GeneralSecurityException("Wake envelope encoding is invalid", error);
        }
    }

    public static final class WakeSignal {
        private final String kind;
        private final long issuedAt;
        private final long sequence;

        WakeSignal(String kind, long issuedAt, long sequence) {
            this.kind = kind;
            this.issuedAt = issuedAt;
            this.sequence = sequence;
        }

        public String kind() { return kind; }
        public long issuedAt() { return issuedAt; }
        public long sequence() { return sequence; }
    }
}
