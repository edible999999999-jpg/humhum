package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.HashMap;
import java.util.Map;
import org.junit.Test;

public class ConnectionStoreTest {
    @Test
    public void savesOnlyDurableConnectionFieldsAndRestoresThem() {
        MemoryStore memory = new MemoryStore();
        ConnectionStore store = new ConnectionStore(memory);
        BridgeConfig config = BridgeConfig.parse(
                "https://192.168.1.20:31276", "A1B2C3D4", "AA".repeat(32), "Xiaomi 14");

        store.save(config, "ab".repeat(32), Models.Scope.CONTROL);
        ConnectionStore.Connection restored = store.load();

        assertFalse(memory.values.containsKey("pairing_code"));
        assertEquals(config.baseUrl(), restored.config().baseUrl());
        assertEquals(config.fingerprint(), restored.config().fingerprint());
        assertEquals(config.deviceName(), restored.config().deviceName());
        assertEquals("ab".repeat(32), restored.token());
        assertEquals(Models.Scope.CONTROL, restored.scope());
    }

    @Test
    public void refusesPartialCredentials() {
        MemoryStore memory = new MemoryStore();
        memory.put("base_url", "https://192.168.1.20:31276");
        memory.put("fingerprint", "AA".repeat(32));

        assertNull(new ConnectionStore(memory).load());
    }

    @Test
    public void disconnectClearsEveryPersistedField() {
        MemoryStore memory = new MemoryStore();
        ConnectionStore store = new ConnectionStore(memory);
        store.save(
                BridgeConfig.parse(
                        "https://humhum.local:31276", "A1B2C3D4", "AA".repeat(32), "Phone"),
                "ab".repeat(32),
                Models.Scope.READ);

        store.clear();

        assertTrue(memory.values.isEmpty());
        assertNull(store.load());
    }

    @Test
    public void persistsOptionalSubscriberRelayWithoutPublisherMaterial() {
        MemoryStore memory = new MemoryStore();
        ConnectionStore store = new ConnectionStore(memory);
        BridgeConfig config = BridgeConfig.parse(
                "https://192.168.1.20:31276", "A1B2C3D4", "AA".repeat(32), "Xiaomi 14");
        Models.WakeRelayConfig relay = new Models.WakeRelayConfig(
                "https://relay.example.com",
                "11".repeat(32),
                "22".repeat(32),
                "33".repeat(32));

        store.save(config, new Models.PairResult("ab".repeat(32), Models.Scope.CONTROL, relay));
        ConnectionStore.Connection restored = store.load();

        assertEquals(relay.baseUrl(), restored.wakeRelay().baseUrl());
        assertEquals(relay.channelId(), restored.wakeRelay().channelId());
        assertEquals(relay.subscriberToken(), restored.wakeRelay().subscriberToken());
        assertEquals(relay.wakeKey(), restored.wakeRelay().wakeKey());
        assertFalse(memory.values.containsKey("publisher_token"));
    }

    @Test
    public void legacyAndPartiallyCorruptRelayDataKeepPrivateBridgePairingUsable() {
        MemoryStore memory = new MemoryStore();
        ConnectionStore store = new ConnectionStore(memory);
        BridgeConfig config = BridgeConfig.parse(
                "https://192.168.1.20:31276", "A1B2C3D4", "AA".repeat(32), "Xiaomi 14");
        store.save(config, "ab".repeat(32), Models.Scope.READ);

        assertNull(store.load().wakeRelay());

        memory.put("relay_base_url", "https://relay.example.com");
        memory.put("relay_channel_id", "11".repeat(32));
        assertNull(store.load().wakeRelay());
        assertEquals("ab".repeat(32), store.load().token());
    }

    private static final class MemoryStore implements ConnectionStore.KeyValueStore {
        final Map<String, String> values = new HashMap<>();

        @Override public String get(String key) { return values.get(key); }
        @Override public void put(String key, String value) { values.put(key, value); }
        @Override public void clear() { values.clear(); }
    }
}
