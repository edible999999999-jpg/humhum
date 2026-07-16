package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class AnywhereGatewayTest {
    @Test
    public void lostPublicationResponseRetriesTheExactCiphertextAndReturnsRemotePage()
            throws Exception {
        Models.WakeRelayConfig relay = relay();
        MemoryStore memory = new MemoryStore();
        AnywhereStateStore state = new AnywhereStateStore(memory);
        List<String> publications = new ArrayList<>();
        final int[] requests = {0};
        byte[] accepted = new JSONObject().put("sequence", 1).toString()
                .getBytes(StandardCharsets.UTF_8);
        AnywhereRelayClient client = new AnywhereRelayClient(request -> {
            if ("POST".equals(request.method())) {
                publications.add(request.body());
                requests[0]++;
                if (requests[0] == 1) throw new IOException("response lost");
                return new AnywhereRelayClient.TransportResponse(201, accepted);
            }
            return remotePageResponse(relay, publications.get(0));
        });
        AnywhereGateway first = new AnywhereGateway(client, state, () -> 1_783_836_000L);

        assertThrows(IOException.class, () -> first.sessions(relay));
        Models.SessionPage page = new AnywhereGateway(client, new AnywhereStateStore(memory),
                () -> 1_783_836_001L).sessions(relay);

        assertEquals(2, publications.size());
        assertEquals(publications.get(0), publications.get(1));
        assertEquals(0, page.sessions().size());
        assertEquals("aa".repeat(32), page.cursor());
        assertEquals(2, state.nextUplinkSequence(relay));
        assertEquals(1, state.downlinkSequence(relay));
    }

    @Test
    public void acceptedRequestKeepsItsIdentityUntilTheMatchingResponseArrives()
            throws Exception {
        Models.WakeRelayConfig relay = relay();
        MemoryStore memory = new MemoryStore();
        AnywhereStateStore state = new AnywhereStateStore(memory);
        List<String> publications = new ArrayList<>();
        final boolean[] answer = {false};
        byte[] accepted = new JSONObject().put("sequence", 1).toString()
                .getBytes(StandardCharsets.UTF_8);
        byte[] empty = new JSONObject().put("messages", new JSONArray()).toString()
                .getBytes(StandardCharsets.UTF_8);
        AnywhereRelayClient client = new AnywhereRelayClient(request -> {
            if ("POST".equals(request.method())) {
                publications.add(request.body());
                return new AnywhereRelayClient.TransportResponse(201, accepted);
            }
            if (!answer[0]) {
                return new AnywhereRelayClient.TransportResponse(200, empty);
            }
            return remotePageResponse(relay, publications.get(0));
        });

        assertThrows(IOException.class, () -> new AnywhereGateway(client, state,
                () -> 1_783_836_000L).sessions(relay));
        assertNotNull(new AnywhereStateStore(memory).pending(relay));
        assertEquals(1, state.nextUplinkSequence(relay));

        answer[0] = true;
        Models.SessionPage page = new AnywhereGateway(
                client, new AnywhereStateStore(memory), () -> 1_783_836_001L)
                .sessions(relay);

        assertEquals(2, publications.size());
        assertEquals(publications.get(0), publications.get(1));
        assertEquals("aa".repeat(32), page.cursor());
        assertNull(state.pending(relay));
        assertEquals(2, state.nextUplinkSequence(relay));
    }

    private static AnywhereRelayClient.TransportResponse remotePageResponse(
            Models.WakeRelayConfig relay, String publication) throws IOException {
        try {
            AnywhereEnvelopeCipher.Message uplink = AnywhereEnvelopeCipher.decrypt(
                    relay.commandKey(), relay.commandChannelId(),
                    AnywhereEnvelopeCipher.Direction.UPLINK, 0,
                    publication, 1_783_836_001);
            JSONObject page = new JSONObject()
                    .put("scope", "read")
                    .put("cursor", "aa".repeat(32))
                    .put("sessions", new JSONArray());
            AnywhereEnvelope response = AnywhereEnvelopeCipher.encrypt(
                    relay.wakeKey(), relay.channelId(),
                    AnywhereEnvelopeCipher.Direction.DOWNLINK, 1, "response",
                    uplink.requestId(), 1_783_836_001, 1_783_836_301,
                    new JSONObject().put("ok", true).put("data", page),
                    "000102030405060708090a0b");
            return new AnywhereRelayClient.TransportResponse(
                    200,
                    new JSONObject().put("messages", new JSONArray().put(
                                    new JSONObject(response.toJson())))
                            .toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception error) {
            throw new IOException("Could not build relay fixture", error);
        }
    }

    private static Models.WakeRelayConfig relay() {
        return new Models.WakeRelayConfig(
                "https://relay.example.com",
                "11".repeat(32), "22".repeat(32), "33".repeat(32),
                "44".repeat(32), "55".repeat(32), "66".repeat(32));
    }

    private static final class MemoryStore implements AnywhereStateStore.KeyValueStore {
        private final java.util.Map<String, String> values = new java.util.HashMap<>();
        @Override public String get(String key) { return values.get(key); }
        @Override public void put(String key, String value) { values.put(key, value); }
        @Override public void putPair(
                String firstKey, String firstValue, String secondKey, String secondValue) {
            values.put(firstKey, firstValue);
            values.put(secondKey, secondValue);
        }
        @Override public void edit(
                java.util.Map<String, String> puts, java.util.Set<String> removals) {
            for (String key : removals) values.remove(key);
            values.putAll(puts);
        }
        @Override public void remove(String key) { values.remove(key); }
        @Override public void clear() { values.clear(); }
    }
}
