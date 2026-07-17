package com.humhum.mobile;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.json.JSONException;
import org.json.JSONObject;

public final class AnywhereEnvelopeCipher {
    private static final int VERSION = 1;
    private static final long MAX_CLOCK_SKEW_SECONDS = 600;
    private static final long MAX_LIFETIME_SECONDS = 86_400;
    private static final int MAX_PLAINTEXT_BYTES = 49_152;
    private static final int MAX_CIPHERTEXT_CHARS = 65_536;

    private AnywhereEnvelopeCipher() {}

    public enum Direction {
        DOWNLINK("downlink"),
        UPLINK("uplink");

        private final String wireValue;

        Direction(String wireValue) {
            this.wireValue = wireValue;
        }

        boolean allows(String kind) {
            return this == UPLINK
                    ? "request".equals(kind)
                    : "snapshot".equals(kind) || "response".equals(kind);
        }
    }

    public static final class Message {
        private final String kind;
        private final String requestId;
        private final long issuedAt;
        private final long expiresAt;
        private final JSONObject body;
        private final long sequence;

        Message(
                String kind,
                String requestId,
                long issuedAt,
                long expiresAt,
                JSONObject body,
                long sequence) {
            this.kind = kind;
            this.requestId = requestId;
            this.issuedAt = issuedAt;
            this.expiresAt = expiresAt;
            this.body = body;
            this.sequence = sequence;
        }

        public String kind() { return kind; }
        public String requestId() { return requestId; }
        public long issuedAt() { return issuedAt; }
        public long expiresAt() { return expiresAt; }
        public JSONObject body() { return body; }
        public long sequence() { return sequence; }
    }

    public static AnywhereEnvelope encrypt(
            String keyHex,
            String channel,
            Direction direction,
            long sequence,
            String kind,
            String requestId,
            long issuedAt,
            long expiresAt,
            JSONObject body,
            String nonceHex) throws GeneralSecurityException, JSONException {
        byte[] key = decodeHex(keyHex, 32);
        decodeHex(channel, 32);
        byte[] nonce = decodeHex(nonceHex, 12);
        validateMessage(direction, kind, requestId, issuedAt, expiresAt, body);
        if (sequence <= 0) throw new GeneralSecurityException("Anywhere sequence is invalid");
        JSONObject message = new JSONObject()
                .put("version", VERSION)
                .put("kind", kind)
                .put("request_id", requestId)
                .put("issued_at", issuedAt)
                .put("expires_at", expiresAt)
                .put("body", new JSONObject(body.toString()));
        byte[] plaintext = message.toString().getBytes(StandardCharsets.UTF_8);
        if (plaintext.length > MAX_PLAINTEXT_BYTES) {
            throw new GeneralSecurityException("Anywhere plaintext is too large");
        }
        Cipher cipher = cipher(Cipher.ENCRYPT_MODE, key, nonce);
        cipher.updateAAD(aad(channel, direction, sequence).getBytes(StandardCharsets.UTF_8));
        return new AnywhereEnvelope(
                VERSION,
                sequence,
                encodeBase64Url(nonce),
                encodeBase64Url(cipher.doFinal(plaintext)));
    }

    public static Message decrypt(
            String keyHex,
            String channel,
            Direction direction,
            long expectedAfter,
            String rawEnvelope,
            long nowSeconds) throws GeneralSecurityException, JSONException {
        byte[] key = decodeHex(keyHex, 32);
        decodeHex(channel, 32);
        JSONObject envelope = new JSONObject(rawEnvelope);
        if (envelope.length() != 4
                || strictLong(envelope, "version") != VERSION
                || !envelope.has("sequence")
                || !envelope.has("nonce")
                || !envelope.has("ciphertext")) {
            throw new GeneralSecurityException("Anywhere envelope is invalid");
        }
        long sequence = strictLong(envelope, "sequence");
        if (sequence <= expectedAfter || nowSeconds <= 0) {
            throw new GeneralSecurityException("Anywhere sequence is invalid");
        }
        String nonceText = strictString(envelope, "nonce");
        String ciphertextText = strictString(envelope, "ciphertext");
        if (nonceText.length() != 16
                || ciphertextText.isEmpty()
                || ciphertextText.length() > MAX_CIPHERTEXT_CHARS) {
            throw new GeneralSecurityException("Anywhere envelope is invalid");
        }
        byte[] nonce = decodeBase64Url(nonceText, 12);
        byte[] ciphertext = decodeBase64Url(ciphertextText, -1);
        if (ciphertext.length < 16) {
            throw new GeneralSecurityException("Anywhere ciphertext is invalid");
        }
        Cipher cipher = cipher(Cipher.DECRYPT_MODE, key, nonce);
        cipher.updateAAD(aad(channel, direction, sequence).getBytes(StandardCharsets.UTF_8));
        byte[] plaintext = cipher.doFinal(ciphertext);
        if (plaintext.length > MAX_PLAINTEXT_BYTES) {
            throw new GeneralSecurityException("Anywhere plaintext is too large");
        }
        JSONObject message = new JSONObject(new String(plaintext, StandardCharsets.UTF_8));
        if (message.length() != 6 || strictLong(message, "version") != VERSION) {
            throw new GeneralSecurityException("Anywhere message is invalid");
        }
        String kind = strictString(message, "kind");
        String requestId = strictString(message, "request_id");
        long issuedAt = strictLong(message, "issued_at");
        long expiresAt = strictLong(message, "expires_at");
        Object rawBody = message.get("body");
        if (!(rawBody instanceof JSONObject)) {
            throw new GeneralSecurityException("Anywhere body is invalid");
        }
        JSONObject body = (JSONObject) rawBody;
        validateMessage(direction, kind, requestId, issuedAt, expiresAt, body);
        if (nowSeconds < issuedAt - MAX_CLOCK_SKEW_SECONDS || nowSeconds > expiresAt) {
            throw new GeneralSecurityException("Anywhere timestamp is invalid");
        }
        return new Message(kind, requestId, issuedAt, expiresAt, body, sequence);
    }

    private static void validateMessage(
            Direction direction,
            String kind,
            String requestId,
            long issuedAt,
            long expiresAt,
            JSONObject body) throws GeneralSecurityException {
        if (direction == null
                || !direction.allows(kind)
                || requestId == null
                || !requestId.matches("[a-f0-9]{32}")
                || issuedAt <= 0
                || expiresAt <= issuedAt
                || expiresAt - issuedAt > MAX_LIFETIME_SECONDS
                || body == null) {
            throw new GeneralSecurityException("Anywhere message is invalid");
        }
    }

    private static Cipher cipher(int mode, byte[] key, byte[] nonce)
            throws GeneralSecurityException {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(mode, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
        return cipher;
    }

    private static String aad(String channel, Direction direction, long sequence) {
        return "humhum-anywhere-v1:" + direction.wireValue + ":" + channel + ":" + sequence;
    }

    private static long strictLong(JSONObject object, String key)
            throws JSONException, GeneralSecurityException {
        Object value = object.get(key);
        if (!(value instanceof Integer) && !(value instanceof Long)) {
            throw new GeneralSecurityException("Anywhere numeric field is invalid");
        }
        return ((Number) value).longValue();
    }

    private static String strictString(JSONObject object, String key)
            throws JSONException, GeneralSecurityException {
        Object value = object.get(key);
        if (!(value instanceof String)) {
            throw new GeneralSecurityException("Anywhere string field is invalid");
        }
        return (String) value;
    }

    private static byte[] decodeHex(String value, int expectedBytes)
            throws GeneralSecurityException {
        if (value == null || !value.matches("[a-f0-9]{" + (expectedBytes * 2) + "}")) {
            throw new GeneralSecurityException("Anywhere configuration is invalid");
        }
        byte[] result = new byte[expectedBytes];
        for (int index = 0; index < expectedBytes; index++) {
            result[index] = (byte) Integer.parseInt(
                    value.substring(index * 2, index * 2 + 2), 16);
        }
        return result;
    }

    private static byte[] decodeBase64Url(String value, int expectedBytes)
            throws GeneralSecurityException {
        try {
            byte[] result = Base64.getUrlDecoder().decode(value);
            if ((expectedBytes >= 0 && result.length != expectedBytes)
                    || !encodeBase64Url(result).equals(value)) {
                throw new GeneralSecurityException("Anywhere encoding is invalid");
            }
            return result;
        } catch (IllegalArgumentException error) {
            throw new GeneralSecurityException("Anywhere encoding is invalid", error);
        }
    }

    private static String encodeBase64Url(byte[] value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }
}
