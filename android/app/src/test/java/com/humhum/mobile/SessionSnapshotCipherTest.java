package com.humhum.mobile;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.nio.charset.StandardCharsets;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.json.JSONObject;
import org.junit.Test;

public class SessionSnapshotCipherTest {
    private static final long SAVED_AT_MILLIS = 1_783_836_000_000L;
    private static final long NOW_MILLIS = SAVED_AT_MILLIS + 60_000L;
    private static final byte[] PAYLOAD = "{\"version\":1}".getBytes(StandardCharsets.UTF_8);
    private static final SecretKey KEY = new SecretKeySpec(new byte[32], "AES");
    private static final byte[] NONCE = new byte[] {
            0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
    };
    private static final String BINDING = "bb".repeat(32);

    @Test
    public void encryptsAndDecryptsWithTheBoundAesGcmEnvelope() throws Exception {
        byte[] envelope = SessionSnapshotCipher.encrypt(PAYLOAD, BINDING, KEY, NONCE, SAVED_AT_MILLIS);
        JSONObject json = new JSONObject(new String(envelope, StandardCharsets.UTF_8));
        SessionSnapshotCipher.Decrypted decrypted = SessionSnapshotCipher.decrypt(
                envelope, BINDING, KEY, NOW_MILLIS);

        assertEquals(4, json.length());
        assertEquals(1, json.getInt("version"));
        assertEquals(SAVED_AT_MILLIS, json.getLong("saved_at_ms"));
        assertEquals("AAECAwQFBgcICQoL", json.getString("nonce"));
        assertArrayEquals(PAYLOAD, decrypted.payload());
        assertEquals(SAVED_AT_MILLIS, decrypted.savedAtMillis());
    }

    @Test
    public void rejectsChangedBindingNonceAndCiphertext() throws Exception {
        byte[] envelope = SessionSnapshotCipher.encrypt(PAYLOAD, BINDING, KEY, NONCE, SAVED_AT_MILLIS);
        JSONObject json = new JSONObject(new String(envelope, StandardCharsets.UTF_8));
        String envelopeText = new String(envelope, StandardCharsets.UTF_8);

        assertThrows(Exception.class,
                () -> SessionSnapshotCipher.decrypt(envelope, "cc".repeat(32), KEY, NOW_MILLIS));
        assertThrows(Exception.class, () -> SessionSnapshotCipher.decrypt(
                new JSONObject(json.toString()).put("nonce", "AQECAwQFBgcICQoL")
                        .toString().getBytes(StandardCharsets.UTF_8),
                BINDING, KEY, NOW_MILLIS));
        assertThrows(Exception.class, () -> SessionSnapshotCipher.decrypt(
                new JSONObject(json.toString()).put("ciphertext",
                        "A" + json.getString("ciphertext").substring(1))
                        .toString().getBytes(StandardCharsets.UTF_8),
                BINDING, KEY, NOW_MILLIS));
        assertThrows(Exception.class, () -> SessionSnapshotCipher.decrypt(
                envelopeText.replace(
                        "\"saved_at_ms\":" + SAVED_AT_MILLIS,
                        "\"saved_at_ms\":" + (SAVED_AT_MILLIS + 1L))
                        .getBytes(StandardCharsets.UTF_8),
                BINDING, KEY, NOW_MILLIS));
    }

    @Test
    public void rejectsMalformedOrOversizedEnvelopes() throws Exception {
        byte[] envelope = SessionSnapshotCipher.encrypt(PAYLOAD, BINDING, KEY, NONCE, SAVED_AT_MILLIS);
        JSONObject json = new JSONObject(new String(envelope, StandardCharsets.UTF_8));

        assertThrows(Exception.class, () -> SessionSnapshotCipher.decrypt(
                new JSONObject(json.toString()).put("private", "leak")
                        .toString().getBytes(StandardCharsets.UTF_8),
                BINDING, KEY, NOW_MILLIS));
        assertThrows(Exception.class, () -> SessionSnapshotCipher.decrypt(
                new JSONObject(json.toString()).put("version", 2)
                        .toString().getBytes(StandardCharsets.UTF_8),
                BINDING, KEY, NOW_MILLIS));
        assertThrows(Exception.class, () -> SessionSnapshotCipher.decrypt(
                new JSONObject(json.toString()).put("nonce", "AAECAwQFBgcICQo")
                        .toString().getBytes(StandardCharsets.UTF_8),
                BINDING, KEY, NOW_MILLIS));
        assertThrows(Exception.class, () -> SessionSnapshotCipher.decrypt(
                new byte[256 * 1024 + 1], BINDING, KEY, NOW_MILLIS));
    }

    @Test
    public void rejectsNonCanonicalJsonFormsTrailingBytesAndMalformedUtf8() throws Exception {
        byte[] envelope = SessionSnapshotCipher.encrypt(PAYLOAD, BINDING, KEY, NONCE, SAVED_AT_MILLIS);
        String json = new String(envelope, StandardCharsets.UTF_8);

        assertInvalid((json + "x").getBytes(StandardCharsets.UTF_8));
        assertInvalid(json.replace("\"version\"", "version").getBytes(StandardCharsets.UTF_8));
        assertInvalid((json.substring(0, json.length() - 1) + ",}")
                .getBytes(StandardCharsets.UTF_8));
        assertInvalid(replaceFirst(envelope, (byte) 'A', (byte) 0x80));
    }

    @Test
    public void rejectsSnapshotsOlderThanSevenDays() throws Exception {
        byte[] envelope = SessionSnapshotCipher.encrypt(PAYLOAD, BINDING, KEY, NONCE, SAVED_AT_MILLIS);

        assertThrows(Exception.class, () -> SessionSnapshotCipher.decrypt(
                envelope, BINDING, KEY,
                SAVED_AT_MILLIS + 7L * 24L * 60L * 60L * 1000L + 1L));
    }

    private static void assertInvalid(byte[] envelope) {
        assertThrows(Exception.class,
                () -> SessionSnapshotCipher.decrypt(envelope, BINDING, KEY, NOW_MILLIS));
    }

    private static byte[] replaceFirst(byte[] source, byte expected, byte replacement) {
        byte[] copy = source.clone();
        for (int index = 0; index < copy.length; index++) {
            if (copy[index] == expected) {
                copy[index] = replacement;
                return copy;
            }
        }
        throw new AssertionError("Test envelope did not contain expected byte");
    }
}
