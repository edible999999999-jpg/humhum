package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import java.util.HashMap;
import java.util.Map;
import org.junit.Test;

public class PushStateStoreTest {
    private static final String CHANNEL = "11".repeat(32);

    @Test
    public void stateIsBoundToTheCurrentChannelAndConfiguration() {
        MemoryStore memory = new MemoryStore();
        PushStateStore store = new PushStateStore(memory);

        store.save(PushStateStore.State.REGISTERED, CHANNEL);

        assertEquals(PushStateStore.State.REGISTERED, store.read(CHANNEL, true));
        assertEquals(PushStateStore.State.DISABLED, store.read("22".repeat(32), true));
        assertEquals(PushStateStore.State.DISABLED, store.read(CHANNEL, false));
        assertFalse(memory.values.containsKey("token"));
    }

    @Test
    public void corruptStateAndClearFailClosed() {
        MemoryStore memory = new MemoryStore();
        PushStateStore store = new PushStateStore(memory);
        memory.put("state", "private-token-value");
        memory.put("channel", CHANNEL);
        assertEquals(PushStateStore.State.DISABLED, store.read(CHANNEL, true));

        store.save(PushStateStore.State.RETRYING, CHANNEL);
        store.clear();
        assertEquals(PushStateStore.State.DISABLED, store.read(CHANNEL, true));
        assertEquals(0, memory.values.size());
    }

    @Test
    public void userCopyContainsNoTechnicalIdentifiers() {
        assertEquals("系统推送尚未配置", PushStateStore.copy(PushStateStore.State.DISABLED));
        assertEquals("系统推送正在连接", PushStateStore.copy(PushStateStore.State.REGISTERING));
        assertEquals("系统推送已就绪", PushStateStore.copy(PushStateStore.State.REGISTERED));
        assertEquals("系统推送暂时不可用，自动重试", PushStateStore.copy(PushStateStore.State.RETRYING));
        assertEquals("系统推送需要重新配对", PushStateStore.copy(PushStateStore.State.NEEDS_PAIRING));
    }

    private static final class MemoryStore implements PushStateStore.KeyValueStore {
        private final Map<String, String> values = new HashMap<>();

        @Override public String get(String key) { return values.get(key); }
        @Override public void put(String key, String value) { values.put(key, value); }
        @Override public void clear() { values.clear(); }
    }
}
