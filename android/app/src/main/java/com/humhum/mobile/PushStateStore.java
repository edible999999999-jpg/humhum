package com.humhum.mobile;

import android.content.SharedPreferences;

public final class PushStateStore {
    private static final String STATE = "state";
    private static final String CHANNEL = "channel";

    public enum State { DISABLED, REGISTERING, REGISTERED, RETRYING, NEEDS_PAIRING }

    interface KeyValueStore {
        String get(String key);
        void put(String key, String value);
        void clear();
    }

    private final KeyValueStore storage;

    public PushStateStore(SharedPreferences preferences) {
        this(new PreferencesStore(preferences));
    }

    PushStateStore(KeyValueStore storage) {
        this.storage = storage;
    }

    public void save(State state, String channel) {
        if (state == null || channel == null || !channel.matches("[a-f0-9]{64}")) {
            clear();
            return;
        }
        storage.put(STATE, state.name().toLowerCase(java.util.Locale.ROOT));
        storage.put(CHANNEL, channel);
    }

    public State read(String currentChannel, boolean configured) {
        if (!configured
                || currentChannel == null
                || !currentChannel.matches("[a-f0-9]{64}")
                || !currentChannel.equals(storage.get(CHANNEL))) {
            return State.DISABLED;
        }
        String value = storage.get(STATE);
        if (value == null) return State.DISABLED;
        try {
            return State.valueOf(value.toUpperCase(java.util.Locale.ROOT));
        } catch (IllegalArgumentException error) {
            return State.DISABLED;
        }
    }

    public void clear() {
        storage.clear();
    }

    public static String copy(State state) {
        return switch (state) {
            case REGISTERING -> "系统推送正在连接";
            case REGISTERED -> "系统推送已就绪";
            case RETRYING -> "系统推送暂时不可用，自动重试";
            case NEEDS_PAIRING -> "系统推送需要重新配对";
            default -> "系统推送尚未配置";
        };
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
