package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import org.json.JSONObject;
import org.junit.Test;

public class WakeEnvelopeTest {
    private static final String KEY =
            "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    private static final String CHANNEL = "11".repeat(32);
    private static final String CIPHERTEXT =
            "PCC9cquB4CGvNvbg1MtUT-ql9EGVHwAdTEXftCpRM4oyJp7Mn7yvhjDJtCCMtszDBhqD82nZ";

    @Test
    public void decryptsTheExactRustWakeVector() throws Exception {
        WakeEnvelope.WakeSignal signal = WakeEnvelope.decrypt(
                KEY, CHANNEL, 0, vector().toString(), 1_783_836_001L);

        assertEquals("wake", signal.kind());
        assertEquals(1_783_836_000L, signal.issuedAt());
        assertEquals(7L, signal.sequence());
    }

    @Test
    public void rejectsTamperingWrongAadReplayUnknownFieldsAndStaleSignals() throws Exception {
        assertThrows(Exception.class, () -> WakeEnvelope.decrypt(
                "ff".repeat(32), CHANNEL, 0, vector().toString(), 1_783_836_001L));
        assertThrows(Exception.class, () -> WakeEnvelope.decrypt(
                KEY, "22".repeat(32), 0, vector().toString(), 1_783_836_001L));
        assertThrows(Exception.class, () -> WakeEnvelope.decrypt(
                KEY, CHANNEL, 7, vector().toString(), 1_783_836_001L));
        assertThrows(Exception.class, () -> WakeEnvelope.decrypt(
                KEY, CHANNEL, 0, new JSONObject(vector().toString())
                        .put("sequence", "7").toString(), 1_783_836_001L));
        assertThrows(Exception.class, () -> WakeEnvelope.decrypt(
                KEY, CHANNEL, 0, new JSONObject(vector().toString())
                        .put("private", "leak").toString(), 1_783_836_001L));
        assertThrows(Exception.class, () -> WakeEnvelope.decrypt(
                KEY, CHANNEL, 0, new JSONObject(vector().toString())
                        .put("ciphertext", "A" + CIPHERTEXT.substring(1)).toString(),
                1_783_836_001L));
        assertThrows(Exception.class, () -> WakeEnvelope.decrypt(
                KEY, CHANNEL, 0, vector().toString(), 1_783_836_601L));
    }

    private static JSONObject vector() throws Exception {
        return new JSONObject()
                .put("version", 1)
                .put("sequence", 7)
                .put("nonce", "AAECAwQFBgcICQoL")
                .put("ciphertext", CIPHERTEXT);
    }
}
