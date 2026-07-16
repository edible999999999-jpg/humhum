package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;

import java.util.HashMap;
import java.util.Map;
import org.json.JSONObject;
import org.junit.Test;

public class AnywhereStateStoreTest {
    @Test
    public void sequencesAreBoundToTheirIndependentChannelsAndNeverMoveBackward() {
        MemoryStore memory = new MemoryStore();
        AnywhereStateStore store = new AnywhereStateStore(memory);
        Models.WakeRelayConfig relay = relay();

        store.advanceDownlink(relay, 4);
        store.completeUplink(relay, 1);

        AnywhereStateStore restored = new AnywhereStateStore(memory);
        assertEquals(4, restored.downlinkSequence(relay));
        assertEquals(2, restored.nextUplinkSequence(relay));
        restored.advanceDownlink(relay, 4);
        assertEquals(4, restored.downlinkSequence(relay));
        assertThrows(IllegalStateException.class, () -> restored.completeUplink(relay, 3));
    }

    @Test
    public void pendingPublicationKeepsTheExactEnvelopeAcrossRestart() throws Exception {
        MemoryStore memory = new MemoryStore();
        AnywhereStateStore store = new AnywhereStateStore(memory);
        Models.WakeRelayConfig relay = relay();
        AnywhereEnvelope envelope = new AnywhereEnvelope(
                1, 1, "AAECAwQFBgcICQoL", "AQIDBA");

        store.savePending(relay, "77".repeat(16), "88".repeat(32), envelope, false);

        AnywhereStateStore.Pending pending = new AnywhereStateStore(memory).pending(relay);
        assertEquals("77".repeat(16), pending.requestId());
        assertEquals("88".repeat(32), pending.bodyDigest());
        assertEquals(envelope.toJson(), pending.envelope().toJson());
        store.completePending(relay);
        assertNull(store.pending(relay));
        assertEquals(2, store.nextUplinkSequence(relay));
    }

    @Test
    public void backgroundConsumerCanHandOneEncryptedResponseToTheForeground() throws Exception {
        MemoryStore memory = new MemoryStore();
        AnywhereStateStore store = new AnywhereStateStore(memory);
        Models.WakeRelayConfig relay = relay();
        JSONObject body = new JSONObject().put("ok", true).put(
                "data", new JSONObject().put("status", "delivered"));

        store.saveResponse(relay, "77".repeat(16), body);

        assertEquals(body.toString(), new AnywhereStateStore(memory)
                .takeResponse(relay, "77".repeat(16)).toString());
        assertNull(store.takeResponse(relay, "77".repeat(16)));
    }

    @Test
    public void backgroundConsumerKeepsSeveralResponsesByRequestId() throws Exception {
        MemoryStore memory = new MemoryStore();
        AnywhereStateStore store = new AnywhereStateStore(memory);
        Models.WakeRelayConfig relay = relay();
        JSONObject first = new JSONObject().put("ok", true).put("data", new JSONObject()
                .put("status", "first"));
        JSONObject second = new JSONObject().put("ok", true).put("data", new JSONObject()
                .put("status", "second"));

        store.saveResponse(relay, "77".repeat(16), first);
        store.saveResponse(relay, "88".repeat(16), second);

        assertEquals(first.toString(), store.takeResponse(relay, "77".repeat(16)).toString());
        assertEquals(second.toString(), store.takeResponse(relay, "88".repeat(16)).toString());
    }

    @Test
    public void foregroundConsumerCommitsResponseAndSequenceTogether() throws Exception {
        MemoryStore memory = new MemoryStore();
        AnywhereStateStore store = new AnywhereStateStore(memory);
        Models.WakeRelayConfig relay = relay();
        JSONObject body = new JSONObject().put("ok", true).put(
                "data", new JSONObject().put("status", "resolved"));

        store.saveResponseAndAdvance(relay, 5, "77".repeat(16), body);

        AnywhereStateStore restored = new AnywhereStateStore(memory);
        assertEquals(5, restored.downlinkSequence(relay));
        assertEquals(body.toString(), restored.takeResponse(relay, "77".repeat(16)).toString());
    }

    @Test
    public void writeResponseFinalizationSurvivesRestartAsOneCompletedResult() throws Exception {
        MemoryStore memory = new MemoryStore();
        AnywhereStateStore store = new AnywhereStateStore(memory);
        Models.WakeRelayConfig relay = relay();
        String requestId = "77".repeat(16);
        String bodyDigest = "88".repeat(32);
        JSONObject body = new JSONObject().put("ok", true).put(
                "data", new JSONObject().put("status", "delivered"));
        store.savePending(relay, requestId, bodyDigest,
                new AnywhereEnvelope(1, 1, "AAECAwQFBgcICQoL", "AQIDBA"), true);
        store.saveResponseAndAdvance(relay, 4, requestId, body);

        assertEquals(body.toString(), store.finalizePendingResponse(
                relay, requestId, 1_000).toString());

        AnywhereStateStore restored = new AnywhereStateStore(memory);
        assertNull(restored.pending(relay));
        assertEquals(2, restored.nextUplinkSequence(relay));
        assertEquals(body.toString(), restored.completedResponse(
                relay, bodyDigest, 1_100).toString());
        assertNull(restored.completedResponse(relay, bodyDigest, 1_301));
        store.savePending(relay, requestId, bodyDigest,
                new AnywhereEnvelope(1, 2, "AAECAwQFBgcICQoL", "AQIDBA"), true);
        store.saveResponseAndAdvance(relay, 5, requestId, body);
        store.finalizePendingResponse(relay, requestId, 2_000);
        restored.clearCompletedIfDifferent(relay, "99".repeat(32));
        assertNull(restored.completedResponse(relay, bodyDigest, 2_001));
    }

    private static Models.WakeRelayConfig relay() {
        return new Models.WakeRelayConfig(
                "https://relay.example.com",
                "11".repeat(32), "22".repeat(32), "33".repeat(32),
                "44".repeat(32), "55".repeat(32), "66".repeat(32));
    }

    private static final class MemoryStore implements AnywhereStateStore.KeyValueStore {
        private final Map<String, String> values = new HashMap<>();

        @Override public String get(String key) { return values.get(key); }
        @Override public void put(String key, String value) { values.put(key, value); }
        @Override public void putPair(
                String firstKey, String firstValue, String secondKey, String secondValue) {
            values.put(firstKey, firstValue);
            values.put(secondKey, secondValue);
        }
        @Override public void edit(Map<String, String> puts, java.util.Set<String> removals) {
            for (String key : removals) values.remove(key);
            values.putAll(puts);
        }
        @Override public void remove(String key) { values.remove(key); }
        @Override public void clear() { values.clear(); }
    }
}
