package com.humhum.mobile;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONException;
import org.json.JSONObject;

public final class SessionSnapshotCipher {
    private static final int VERSION = 1;
    private static final int NONCE_BYTES = 12;
    private static final int GCM_TAG_BYTES = 16;
    private static final int MAX_ENVELOPE_BYTES = 256 * 1024;
    private static final long MAX_AGE_MILLIS = 7L * 24L * 60L * 60L * 1000L;

    private SessionSnapshotCipher() {}

    public static byte[] encrypt(
            byte[] payload, String binding, SecretKey key, byte[] nonce, long savedAtMillis)
            throws GeneralSecurityException {
        if (payload == null || payload.length > MAX_ENVELOPE_BYTES) {
            throw new GeneralSecurityException("Snapshot payload is invalid");
        }
        requireBindingAndKey(binding, key);
        if (nonce == null || nonce.length != NONCE_BYTES || savedAtMillis <= 0) {
            throw new GeneralSecurityException("Snapshot encryption inputs are invalid");
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, nonce));
        cipher.updateAAD(binding.getBytes(StandardCharsets.UTF_8));
        byte[] ciphertext = cipher.doFinal(payload);
        try {
            byte[] envelope = new JSONObject()
                    .put("version", VERSION)
                    .put("saved_at_ms", savedAtMillis)
                    .put("nonce", Base64.getUrlEncoder().withoutPadding().encodeToString(nonce))
                    .put("ciphertext", Base64.getUrlEncoder().withoutPadding().encodeToString(ciphertext))
                    .toString()
                    .getBytes(StandardCharsets.UTF_8);
            if (envelope.length > MAX_ENVELOPE_BYTES) {
                throw new GeneralSecurityException("Snapshot envelope is too large");
            }
            return envelope;
        } catch (JSONException error) {
            throw new GeneralSecurityException("Snapshot envelope is invalid", error);
        }
    }

    public static Decrypted decrypt(byte[] envelope, String binding, SecretKey key, long nowMillis)
            throws GeneralSecurityException {
        if (envelope == null || envelope.length == 0 || envelope.length > MAX_ENVELOPE_BYTES) {
            throw new GeneralSecurityException("Snapshot envelope is invalid");
        }
        requireBindingAndKey(binding, key);
        try {
            JSONObject value = new JSONObject(new String(envelope, StandardCharsets.UTF_8));
            if (value.length() != 4
                    || !value.has("version")
                    || !value.has("saved_at_ms")
                    || !value.has("nonce")
                    || !value.has("ciphertext")
                    || strictInt(value, "version") != VERSION) {
                throw new IllegalArgumentException("Snapshot envelope is invalid");
            }
            long savedAtMillis = strictLong(value, "saved_at_ms");
            validateAge(savedAtMillis, nowMillis);
            byte[] nonce = decodeBase64Url(strictString(value, "nonce"), NONCE_BYTES);
            byte[] ciphertext = decodeBase64Url(strictString(value, "ciphertext"), -1);
            if (ciphertext.length < GCM_TAG_BYTES) {
                throw new IllegalArgumentException("Snapshot ciphertext is invalid");
            }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, nonce));
            cipher.updateAAD(binding.getBytes(StandardCharsets.UTF_8));
            return new Decrypted(cipher.doFinal(ciphertext), savedAtMillis);
        } catch (JSONException | IllegalArgumentException error) {
            throw new GeneralSecurityException("Snapshot envelope is invalid", error);
        }
    }

    private static void requireBindingAndKey(String binding, SecretKey key)
            throws GeneralSecurityException {
        if (binding == null || binding.isEmpty() || key == null) {
            throw new GeneralSecurityException("Snapshot encryption inputs are invalid");
        }
    }

    private static int strictInt(JSONObject object, String key) throws JSONException {
        Object value = object.get(key);
        if (!(value instanceof Integer)) throw new IllegalArgumentException("Snapshot value is invalid");
        return (Integer) value;
    }

    private static long strictLong(JSONObject object, String key) throws JSONException {
        Object value = object.get(key);
        if (!(value instanceof Integer) && !(value instanceof Long)) {
            throw new IllegalArgumentException("Snapshot value is invalid");
        }
        return ((Number) value).longValue();
    }

    private static String strictString(JSONObject object, String key) throws JSONException {
        Object value = object.get(key);
        if (!(value instanceof String)) throw new IllegalArgumentException("Snapshot value is invalid");
        return (String) value;
    }

    private static byte[] decodeBase64Url(String value, int expectedBytes) {
        try {
            byte[] decoded = Base64.getUrlDecoder().decode(value);
            if ((expectedBytes >= 0 && decoded.length != expectedBytes)
                    || !Base64.getUrlEncoder().withoutPadding().encodeToString(decoded).equals(value)) {
                throw new IllegalArgumentException("Snapshot envelope encoding is invalid");
            }
            return decoded;
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException("Snapshot envelope encoding is invalid", error);
        }
    }

    private static void validateAge(long savedAtMillis, long nowMillis) {
        if (savedAtMillis <= 0 || nowMillis <= 0 || savedAtMillis > nowMillis
                || nowMillis - savedAtMillis > MAX_AGE_MILLIS) {
            throw new IllegalArgumentException("Snapshot age is invalid");
        }
    }

    public static final class Decrypted {
        private final byte[] payload;
        private final long savedAtMillis;

        private Decrypted(byte[] payload, long savedAtMillis) {
            this.payload = payload.clone();
            this.savedAtMillis = savedAtMillis;
        }

        public byte[] payload() { return payload.clone(); }
        public long savedAtMillis() { return savedAtMillis; }
    }
}
