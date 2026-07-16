package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import org.json.JSONObject;
import org.junit.Test;

public class AnywhereEnvelopeCipherTest {
    private static final String KEY =
            "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    private static final String CHANNEL = "11".repeat(32);
    private static final String REQUEST_ID = "aa".repeat(16);
    private static final String CIPHERTEXT =
            "PCCgfreWq3TjY626ncsTBO2ypQ7SCToNTQKW8T9FIsBkYduZ3LVN8RCGRc_p5klZjzgB7Du3wrte9kt4eYKUj5FdpxuysEcAfTXLD82jLIFL-bwHEjwyHN_Hr_tAw4G-_chp1ohjrWLudUzXOypAC5hdU5zb9h2pe8xn_a7EDGHfKyL8z_W4MGeRLYMH-D6nV5DBSEgpowo8BpnnvTwZYsDMeE8J";

    @Test
    public void decryptsRustVectorAndRoundTripsAndroidEnvelope() throws Exception {
        AnywhereEnvelopeCipher.Message rustMessage = AnywhereEnvelopeCipher.decrypt(
                KEY,
                CHANNEL,
                AnywhereEnvelopeCipher.Direction.UPLINK,
                0,
                vector().toString(),
                1_783_836_001L);
        assertEquals("request", rustMessage.kind());
        assertEquals(REQUEST_ID, rustMessage.requestId());

        AnywhereEnvelope envelope = AnywhereEnvelopeCipher.encrypt(
                KEY,
                CHANNEL,
                AnywhereEnvelopeCipher.Direction.UPLINK,
                7,
                "request",
                REQUEST_ID,
                1_783_836_000L,
                1_783_836_300L,
                new JSONObject().put("scope", "read"),
                "000102030405060708090a0b");

        assertEquals("AAECAwQFBgcICQoL", envelope.nonce());
        AnywhereEnvelopeCipher.Message message = AnywhereEnvelopeCipher.decrypt(
                KEY,
                CHANNEL,
                AnywhereEnvelopeCipher.Direction.UPLINK,
                0,
                envelope.toJson(),
                1_783_836_001L);
        assertEquals("request", message.kind());
        assertEquals(REQUEST_ID, message.requestId());
        assertEquals("read", message.body().getString("scope"));
        assertEquals(7L, message.sequence());
    }

    @Test
    public void rejectsDirectionReplayExpiryUnknownFieldsAndTampering() throws Exception {
        JSONObject envelope = vector();
        assertThrows(Exception.class, () -> AnywhereEnvelopeCipher.decrypt(
                KEY, CHANNEL, AnywhereEnvelopeCipher.Direction.DOWNLINK,
                0, envelope.toString(), 1_783_836_001L));
        assertThrows(Exception.class, () -> AnywhereEnvelopeCipher.decrypt(
                KEY, CHANNEL, AnywhereEnvelopeCipher.Direction.UPLINK,
                7, envelope.toString(), 1_783_836_001L));
        assertThrows(Exception.class, () -> AnywhereEnvelopeCipher.decrypt(
                KEY, CHANNEL, AnywhereEnvelopeCipher.Direction.UPLINK,
                0, envelope.toString(), 1_783_836_301L));
        assertThrows(Exception.class, () -> AnywhereEnvelopeCipher.decrypt(
                KEY, CHANNEL, AnywhereEnvelopeCipher.Direction.UPLINK,
                0, new JSONObject(envelope.toString()).put("plaintext", true).toString(),
                1_783_836_001L));
        assertThrows(Exception.class, () -> AnywhereEnvelopeCipher.decrypt(
                KEY, CHANNEL, AnywhereEnvelopeCipher.Direction.UPLINK,
                0, new JSONObject(envelope.toString())
                        .put("ciphertext", "A" + CIPHERTEXT.substring(1)).toString(),
                1_783_836_001L));
    }

    private static JSONObject vector() throws Exception {
        return new JSONObject()
                .put("version", 1)
                .put("sequence", 7)
                .put("nonce", "AAECAwQFBgcICQoL")
                .put("ciphertext", CIPHERTEXT);
    }
}
