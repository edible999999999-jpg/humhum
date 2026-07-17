package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;

public class RelayPairingClientTest {
    @Test
    public void pairsThroughTemporaryEncryptedChannelsWithoutCallingTheMacAddress()
            throws Exception {
        long now = System.currentTimeMillis() / 1000L;
        String requestChannel = "44".repeat(32);
        String requestKey = "66".repeat(32);
        String responseChannel = "11".repeat(32);
        String responseKey = "33".repeat(32);
        AtomicReference<String> requestId = new AtomicReference<>();
        AtomicReference<String> replyKey = new AtomicReference<>();

        AnywhereRelayClient relay = new AnywhereRelayClient(request -> {
            try {
                if ("POST".equals(request.method())) {
                    AnywhereEnvelopeCipher.Message message = AnywhereEnvelopeCipher.decrypt(
                        requestKey,
                        requestChannel,
                        AnywhereEnvelopeCipher.Direction.UPLINK,
                        0,
                        request.body(),
                        System.currentTimeMillis() / 1000L);
                    assertEquals("pair", message.body().getString("operation"));
                    assertEquals("568FD1A4", message.body().getString("code"));
                    assertEquals("Xiaomi 14", message.body().getString("device_name"));
                    replyKey.set(message.body().getString("reply_key"));
                    requestId.set(message.requestId());
                    return new AnywhereRelayClient.TransportResponse(
                            201,
                            new JSONObject().put("sequence", message.sequence())
                                    .toString().getBytes(StandardCharsets.UTF_8));
                }

                JSONObject finalRelay = new JSONObject()
                    .put("version", 2)
                    .put("base_url", "https://relay.example.com")
                    .put("channel_id", "77".repeat(32))
                    .put("subscriber_token", "88".repeat(32))
                    .put("wake_key", "99".repeat(32))
                    .put("command", new JSONObject()
                            .put("channel_id", "aa".repeat(32))
                            .put("publisher_token", "bb".repeat(32))
                            .put("key", "cc".repeat(32)));
                JSONObject pairing = new JSONObject()
                            .put("token", "dd".repeat(32))
                            .put("scope", "control")
                            .put("wake_relay", finalRelay);
                AnywhereEnvelope sealed = AnywhereEnvelopeCipher.encrypt(
                    replyKey.get(),
                    RelayPairingClient.responseChannel(requestId.get()),
                    AnywhereEnvelopeCipher.Direction.DOWNLINK,
                    1,
                    "response",
                    requestId.get(),
                    now,
                    now + 300,
                    new JSONObject().put("pairing", pairing),
                    "01".repeat(12));
                JSONObject body = new JSONObject()
                    .put("ok", true)
                    .put("sealed", new JSONObject(sealed.toJson()));
                AnywhereEnvelope envelope = AnywhereEnvelopeCipher.encrypt(
                    responseKey,
                    responseChannel,
                    AnywhereEnvelopeCipher.Direction.DOWNLINK,
                    1,
                    "response",
                    requestId.get(),
                    now,
                    now + 300,
                    body,
                    "00".repeat(12));
                JSONObject payload = new JSONObject().put(
                        "messages",
                        new org.json.JSONArray().put(new JSONObject(envelope.toJson())));
                return new AnywhereRelayClient.TransportResponse(
                        200, payload.toString().getBytes(StandardCharsets.UTF_8));
            } catch (Exception error) {
                throw new IOException(error);
            }
        });
        PairingSetup setup = PairingSetup.parse(
                "{\"version\":2,\"url\":\"https://30.169.112.223:31276\","
                        + "\"code\":\"568FD1A4\",\"scope\":\"control\","
                        + "\"fingerprint\":\"" + "AA".repeat(32) + "\","
                        + "\"expires_at\":" + (now + 300) + ","
                        + "\"pairing_relay\":{\"version\":2,"
                        + "\"base_url\":\"https://relay.example.com\","
                        + "\"channel_id\":\"" + responseChannel + "\","
                        + "\"subscriber_token\":\"" + "22".repeat(32) + "\","
                        + "\"wake_key\":\"" + responseKey + "\","
                        + "\"command\":{\"channel_id\":\"" + requestChannel + "\","
                        + "\"publisher_token\":\"" + "55".repeat(32) + "\","
                        + "\"key\":\"" + requestKey + "\"}}}");

        Models.PairResult result = new RelayPairingClient(relay).pair(setup, "Xiaomi 14");

        assertEquals("dd".repeat(32), result.token());
        assertEquals(Models.Scope.CONTROL, result.scope());
        assertNotNull(result.wakeRelay());
        assertEquals("77".repeat(32), result.wakeRelay().channelId());
    }

    @Test
    public void responseChannelMatchesTheDesktopDerivation() {
        assertEquals(
                "37a5337f5150b1d1c80cca8a7a1988a68ba8c9bc57947064ce841358b466ea81",
                RelayPairingClient.responseChannel("77".repeat(16)));
    }
}
