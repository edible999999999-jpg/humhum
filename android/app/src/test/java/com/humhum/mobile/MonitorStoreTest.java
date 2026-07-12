package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.Test;

public class MonitorStoreTest {
    @Test
    public void enabledChoiceSurvivesStoreRecreation() {
        MemoryStore memory = new MemoryStore();
        MonitorStore first = new MonitorStore(memory);

        assertFalse(first.isEnabled());
        first.setEnabled(true);

        assertTrue(new MonitorStore(memory).isEnabled());
    }

    @Test
    public void knownDigestsAreValidatedAndBounded() {
        MemoryStore memory = new MemoryStore();
        MonitorStore store = new MonitorStore(memory);
        List<String> values = new ArrayList<>();
        values.add("not-a-digest");
        for (int index = 0; index < 205; index++) {
            values.add(String.format("%064x", index));
        }

        store.saveKnownDigests(values);
        List<String> restored = new MonitorStore(memory).knownDigests();

        assertEquals(200, restored.size());
        assertEquals(String.format("%064x", 5), restored.get(0));
        assertTrue(restored.stream().allMatch(value -> value.matches("[a-f0-9]{64}")));
    }

    @Test
    public void clearRemovesChoiceAndHistory() {
        MemoryStore memory = new MemoryStore();
        MonitorStore store = new MonitorStore(memory);
        store.setEnabled(true);
        store.saveKnownDigests(List.of("a".repeat(64)));

        store.clear();

        assertFalse(store.isEnabled());
        assertTrue(store.knownDigests().isEmpty());
    }

    @Test
    public void relaySequenceSurvivesRestartAndNeverMovesBackward() {
        MemoryStore memory = new MemoryStore();
        MonitorStore store = new MonitorStore(memory);
        String firstChannel = "11".repeat(32);
        String replacementChannel = "22".repeat(32);

        assertEquals(0, store.relaySequence(firstChannel));
        store.saveRelaySequence(firstChannel, 7);
        store.saveRelaySequence(firstChannel, 3);

        assertEquals(7, new MonitorStore(memory).relaySequence(firstChannel));
        assertEquals(0, store.relaySequence(replacementChannel));
        store.saveRelaySequence(replacementChannel, 1);
        assertEquals(1, store.relaySequence(replacementChannel));
        assertEquals(0, store.relaySequence(firstChannel));
        memory.put("relay_cursor", "invalid");
        assertEquals(0, store.relaySequence(replacementChannel));
    }

    private static final class MemoryStore implements MonitorStore.KeyValueStore {
        private final Map<String, String> values = new HashMap<>();

        @Override public String get(String key) { return values.get(key); }
        @Override public void put(String key, String value) { values.put(key, value); }
        @Override public void clear() { values.clear(); }
    }
}
