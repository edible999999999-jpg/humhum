package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class AnywhereRelayClientTest {
    @Test
    public void requestPublicationUsesOnlyTheUplinkPublisherCredential() throws Exception {
        Models.WakeRelayConfig relay = relay();
        AnywhereEnvelope envelope = AnywhereEnvelopeCipher.encrypt(
                relay.commandKey(),
                relay.commandChannelId(),
                AnywhereEnvelopeCipher.Direction.UPLINK,
                3,
                "request",
                "77".repeat(16),
                1_783_836_000,
                1_783_836_300,
                new JSONObject().put("action", "refresh"),
                "000102030405060708090a0b");

        AnywhereRelayClient.RequestSpec request =
                AnywhereRelayClient.publishRequest(relay, envelope);

        assertEquals("POST", request.method());
        assertEquals(
                relay.baseUrl() + "/v1/channels/" + relay.commandChannelId() + "/messages",
                request.url());
        assertEquals("Bearer " + relay.commandPublisherToken(), request.authorization());
        assertEquals(envelope.toJson(), request.body());
    }

    @Test
    public void pollingDecryptsContiguousDownlinkMessagesWithSubscriberCredential()
            throws Exception {
        Models.WakeRelayConfig relay = relay();
        AnywhereEnvelope snapshot = AnywhereEnvelopeCipher.encrypt(
                relay.wakeKey(),
                relay.channelId(),
                AnywhereEnvelopeCipher.Direction.DOWNLINK,
                8,
                "snapshot",
                "88".repeat(16),
                1_783_836_000,
                1_783_922_400,
                new JSONObject().put("scope", "read").put("sessions", new JSONArray()),
                "0c0d0e0f1011121314151617");
        String payload = new JSONObject()
                .put("messages", new JSONArray().put(new JSONObject(snapshot.toJson())))
                .toString();
        final AnywhereRelayClient.RequestSpec[] captured = {null};
        AnywhereRelayClient client = new AnywhereRelayClient(request -> {
            captured[0] = request;
            return new AnywhereRelayClient.TransportResponse(
                    HttpURLConnection.HTTP_OK, payload.getBytes(StandardCharsets.UTF_8));
        });

        List<AnywhereEnvelopeCipher.Message> messages =
                client.poll(relay, 7, 0, 1_783_836_001);

        assertEquals(1, messages.size());
        assertEquals("snapshot", messages.get(0).kind());
        assertEquals(8, messages.get(0).sequence());
        assertEquals("Bearer " + relay.subscriberToken(), captured[0].authorization());
        assertEquals(
                relay.baseUrl() + "/v1/channels/" + relay.channelId()
                        + "/messages?after=7&wait=0",
                captured[0].url());
    }

    @Test
    public void pollingRecoversFromASequenceGapAfterRelayRetention() throws Exception {
        Models.WakeRelayConfig relay = relay();
        AnywhereEnvelope snapshot = AnywhereEnvelopeCipher.encrypt(
                relay.wakeKey(), relay.channelId(),
                AnywhereEnvelopeCipher.Direction.DOWNLINK, 130, "snapshot",
                "aa".repeat(16), 1_783_836_000, 1_783_922_400,
                new JSONObject().put("scope", "read").put("sessions", new JSONArray()),
                "000102030405060708090a0b");
        byte[] payload = new JSONObject().put("messages", new JSONArray().put(
                        new JSONObject(snapshot.toJson())))
                .toString().getBytes(StandardCharsets.UTF_8);
        AnywhereRelayClient client = new AnywhereRelayClient(request ->
                new AnywhereRelayClient.TransportResponse(200, payload));

        assertEquals(130, client.poll(relay, 1, 0, 1_783_836_001).get(0).sequence());
    }

    @Test
    public void publicationRequiresExactCreatedSequenceAndRejectsRedirects() throws Exception {
        Models.WakeRelayConfig relay = relay();
        AnywhereEnvelope envelope = AnywhereEnvelopeCipher.encrypt(
                relay.commandKey(), relay.commandChannelId(),
                AnywhereEnvelopeCipher.Direction.UPLINK, 1, "request", "99".repeat(16),
                1_783_836_000, 1_783_836_300,
                new JSONObject().put("action", "refresh"),
                "000102030405060708090a0b");
        byte[] acceptedBody = new JSONObject().put("sequence", 1).toString()
                .getBytes(StandardCharsets.UTF_8);
        AnywhereRelayClient accepted = new AnywhereRelayClient(request ->
                new AnywhereRelayClient.TransportResponse(
                        201, acceptedBody));
        accepted.publish(relay, envelope);

        AnywhereRelayClient redirect = new AnywhereRelayClient(request ->
                new AnywhereRelayClient.TransportResponse(302, new byte[0]));
        assertThrows(AnywhereRelayClient.RelayStatusException.class,
                () -> redirect.publish(relay, envelope));
    }

    private static Models.WakeRelayConfig relay() {
        return new Models.WakeRelayConfig(
                "https://relay.example.com",
                "11".repeat(32),
                "22".repeat(32),
                "33".repeat(32),
                "44".repeat(32),
                "55".repeat(32),
                "66".repeat(32));
    }
}
