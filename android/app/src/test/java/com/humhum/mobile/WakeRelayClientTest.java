package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.security.GeneralSecurityException;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class WakeRelayClientTest {
    @Test
    public void acceptsPublicHttpsAndExactLoopbackHttpOnly() {
        assertEquals("https://relay.example.com", WakeRelayClient.validateBaseUrl(
                "https://relay.example.com"));
        assertEquals("http://127.0.0.1:3005", WakeRelayClient.validateBaseUrl(
                "http://127.0.0.1:3005"));
        assertEquals("http://[::1]:3005", WakeRelayClient.validateBaseUrl(
                "http://[::1]:3005"));
        assertThrows(IllegalArgumentException.class,
                () -> WakeRelayClient.validateBaseUrl("http://relay.example.com"));
        assertThrows(IllegalArgumentException.class,
                () -> WakeRelayClient.validateBaseUrl("https://user:pass@relay.example.com"));
        assertThrows(IllegalArgumentException.class,
                () -> WakeRelayClient.validateBaseUrl("https://relay.example.com/path"));
    }

    @Test
    public void pollUsesSubscriberCredentialAndBoundedLongWait() {
        Models.WakeRelayConfig config = relay();

        WakeRelayClient.RequestSpec request = WakeRelayClient.pollRequest(config, 7);

        assertEquals("GET", request.method());
        assertEquals(
                "https://relay.example.com/v1/channels/" + "11".repeat(32)
                        + "/messages?after=7&wait=20",
                request.url());
        assertEquals("Bearer " + "22".repeat(32), request.authorization());
        assertEquals(25_000, request.readTimeoutMillis());
        assertFalse(request.authorization().contains("33".repeat(32)));
    }

    @Test
    public void parserAcceptsOnlyOrderedMinimalEncryptedEnvelopes() throws Exception {
        JSONObject first = new JSONObject()
                .put("version", 1)
                .put("sequence", 8)
                .put("nonce", "AAECAwQFBgcICQoL")
                .put("ciphertext", "AQID");
        String payload = new JSONObject().put("messages", new JSONArray().put(first)).toString();

        java.util.List<WakeEnvelope> messages = WakeRelayClient.parseMessages(payload, 7);

        assertEquals(1, messages.size());
        assertEquals(8, messages.get(0).sequence());
        assertThrows(org.json.JSONException.class, () -> WakeRelayClient.parseMessages(
                new JSONObject(payload).put("plaintext", "private").toString(), 7));
        assertThrows(org.json.JSONException.class, () -> WakeRelayClient.parseMessages(
                new JSONObject().put("messages", new JSONArray().put(
                        new JSONObject(first.toString()).put("sequence", 7))).toString(), 7));
        assertThrows(org.json.JSONException.class, () -> WakeRelayClient.parseMessages(
                new JSONObject().put("messages", new JSONArray().put(
                        new JSONObject(first.toString()).put("sequence", "8"))).toString(), 7));
    }

    @Test
    public void fallbackPolicyKeepsDirectWatchAvailable() {
        assertTrue(WakeRelayClient.shouldUseRelay(relay(), true));
        assertFalse(WakeRelayClient.shouldUseRelay(null, true));
        assertFalse(WakeRelayClient.shouldUseRelay(relay(), false));
        assertTrue(WakeRelayClient.isPermanentlyUnavailable(404));
        assertTrue(WakeRelayClient.isPermanentlyUnavailable(410));
        assertFalse(WakeRelayClient.isPermanentlyUnavailable(500));
    }

    @Test
    public void authenticatedMessagesAdvanceSequenceAndTamperingDoesNot() throws Exception {
        String vector = new JSONObject()
                .put("version", 1)
                .put("sequence", 7)
                .put("nonce", "AAECAwQFBgcICQoL")
                .put("ciphertext",
                        "PCC9cquB4CGvNvbg1MtUT-ql9EGVHwAdTEXftCpRM4oyJp7Mn7yvhjDJtCCMtszDBhqD82nZ")
                .toString();
        List<WakeEnvelope> messages = WakeRelayClient.parseMessages(
                new JSONObject().put("messages", new JSONArray().put(new JSONObject(vector)))
                        .toString(),
                6);

        Models.WakeRelayConfig vectorRelay = new Models.WakeRelayConfig(
                "https://relay.example.com",
                "11".repeat(32),
                "22".repeat(32),
                "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
        assertEquals(7, WakeRelayClient.authenticate(
                vectorRelay, 6, messages, 1_783_836_001));

        List<WakeEnvelope> tampered = WakeRelayClient.parseMessages(
                new JSONObject().put("messages", new JSONArray().put(
                        new JSONObject(vector).put("ciphertext", "A" +
                                new JSONObject(vector).getString("ciphertext").substring(1))))
                        .toString(),
                6);
        assertThrows(GeneralSecurityException.class, () -> WakeRelayClient.authenticate(
                vectorRelay, 6, tampered, 1_783_836_001));
    }

    @Test
    public void transportAcceptsOnlyBoundedSuccessAndReturnsAuthenticatedSequence() throws Exception {
        Models.WakeRelayConfig vectorRelay = vectorRelay();
        String body = new JSONObject().put("messages", new JSONArray().put(new JSONObject()
                .put("version", 1)
                .put("sequence", 7)
                .put("nonce", "AAECAwQFBgcICQoL")
                .put("ciphertext",
                        "PCC9cquB4CGvNvbg1MtUT-ql9EGVHwAdTEXftCpRM4oyJp7Mn7yvhjDJtCCMtszDBhqD82nZ")))
                .toString();
        WakeRelayClient client = new WakeRelayClient(request -> {
            assertEquals("Bearer " + "22".repeat(32), request.authorization());
            return new WakeRelayClient.TransportResponse(200, body.getBytes(StandardCharsets.UTF_8));
        });

        assertEquals(7, client.poll(vectorRelay, 6, 1_783_836_001));

        WakeRelayClient redirect = new WakeRelayClient(request ->
                new WakeRelayClient.TransportResponse(302, new byte[0]));
        assertThrows(WakeRelayClient.RelayStatusException.class,
                () -> redirect.poll(vectorRelay, 6, 1_783_836_001));
        WakeRelayClient oversized = new WakeRelayClient(request ->
                new WakeRelayClient.TransportResponse(200, new byte[1_048_577]));
        assertThrows(IOException.class,
                () -> oversized.poll(vectorRelay, 6, 1_783_836_001));
    }

    @Test
    public void cancelIsForwardedToTheActiveTransport() {
        final boolean[] cancelled = {false};
        WakeRelayClient.Transport transport = new WakeRelayClient.Transport() {
            @Override public WakeRelayClient.TransportResponse execute(
                    WakeRelayClient.RequestSpec request) throws IOException {
                return new WakeRelayClient.TransportResponse(500, new byte[0]);
            }

            @Override public void cancel() {
                cancelled[0] = true;
            }
        };
        WakeRelayClient client = new WakeRelayClient(transport);

        client.cancel();

        assertTrue(cancelled[0]);
    }

    private static Models.WakeRelayConfig relay() {
        return new Models.WakeRelayConfig(
                "https://relay.example.com",
                "11".repeat(32),
                "22".repeat(32),
                "33".repeat(32));
    }

    private static Models.WakeRelayConfig vectorRelay() {
        return new Models.WakeRelayConfig(
                "https://relay.example.com",
                "11".repeat(32),
                "22".repeat(32),
                "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    }
}
