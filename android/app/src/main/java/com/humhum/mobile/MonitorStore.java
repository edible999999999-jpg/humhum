package com.humhum.mobile;

import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;

public final class MonitorStore {
    private static final String ENABLED = "enabled";
    private static final String KNOWN_DIGESTS = "known_digests";
    private static final String RELAY_CURSOR = "relay_cursor";

    interface KeyValueStore {
        String get(String key);
        void put(String key, String value);
        void clear();
    }

    private final KeyValueStore storage;

    public MonitorStore(SharedPreferences preferences) {
        this(new PreferencesStore(preferences));
    }

    MonitorStore(KeyValueStore storage) {
        this.storage = storage;
    }

    public boolean isEnabled() {
        return "true".equals(storage.get(ENABLED));
    }

    public void setEnabled(boolean enabled) {
        storage.put(ENABLED, Boolean.toString(enabled));
    }

    public List<String> knownDigests() {
        String payload = storage.get(KNOWN_DIGESTS);
        if (payload == null || payload.isBlank()) return List.of();
        try {
            JSONArray source = new JSONArray(payload);
            LinkedHashSet<String> valid = new LinkedHashSet<>();
            for (int index = 0; index < source.length(); index++) {
                String value = source.optString(index, "");
                if (value.matches("[a-f0-9]{64}")) valid.add(value);
            }
            return keepNewest(valid);
        } catch (JSONException error) {
            return List.of();
        }
    }

    public void saveKnownDigests(Collection<String> digests) {
        JSONArray payload = new JSONArray();
        for (String digest : keepNewest(digests)) payload.put(digest);
        storage.put(KNOWN_DIGESTS, payload.toString());
    }

    public long relaySequence(String channelId) {
        if (channelId == null || !channelId.matches("[a-f0-9]{64}")) return 0;
        String value = storage.get(RELAY_CURSOR);
        if (value == null) return 0;
        int separator = value.indexOf(':');
        if (separator != 64 || !channelId.equals(value.substring(0, separator))) return 0;
        String sequenceText = value.substring(separator + 1);
        if (!sequenceText.matches("[0-9]{1,19}")) return 0;
        try {
            long sequence = Long.parseLong(sequenceText);
            return Math.max(0, sequence);
        } catch (NumberFormatException error) {
            return 0;
        }
    }

    public void saveRelaySequence(String channelId, long sequence) {
        if (channelId == null || !channelId.matches("[a-f0-9]{64}") || sequence <= 0) return;
        if (sequence > relaySequence(channelId)) {
            storage.put(RELAY_CURSOR, channelId + ":" + sequence);
        }
    }

    public void clear() {
        storage.clear();
    }

    private static List<String> keepNewest(Collection<String> source) {
        if (source == null) return List.of();
        LinkedHashSet<String> valid = new LinkedHashSet<>();
        for (String value : source) {
            if (value != null && value.matches("[a-f0-9]{64}")) valid.add(value);
        }
        List<String> values = new ArrayList<>(valid);
        int start = Math.max(0, values.size() - AttentionTracker.MAX_DIGESTS);
        return List.copyOf(values.subList(start, values.size()));
    }

    private static final class PreferencesStore implements KeyValueStore {
        private final SharedPreferences preferences;

        PreferencesStore(SharedPreferences preferences) {
            this.preferences = preferences;
        }

        @Override public String get(String key) {
            return preferences.getString(key, null);
        }

        @Override public void put(String key, String value) {
            preferences.edit().putString(key, value).apply();
        }

        @Override public void clear() {
            preferences.edit().clear().apply();
        }
    }
}
