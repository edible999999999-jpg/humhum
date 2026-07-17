package com.humhum.mobile;

import android.content.SharedPreferences;

public final class ConnectionStore {
    private static final String BASE_URL = "base_url";
    private static final String FINGERPRINT = "fingerprint";
    private static final String DEVICE_NAME = "device_name";
    private static final String TOKEN = "token";
    private static final String SCOPE = "scope";
    private static final String RELAY_BASE_URL = "relay_base_url";
    private static final String RELAY_CHANNEL_ID = "relay_channel_id";
    private static final String RELAY_SUBSCRIBER_TOKEN = "relay_subscriber_token";
    private static final String RELAY_WAKE_KEY = "relay_wake_key";
    private static final String RELAY_COMMAND_CHANNEL_ID = "relay_command_channel_id";
    private static final String RELAY_COMMAND_PUBLISHER_TOKEN = "relay_command_publisher_token";
    private static final String RELAY_COMMAND_KEY = "relay_command_key";
    private static final String PREFER_RELAY = "prefer_relay";

    interface KeyValueStore {
        String get(String key);
        void put(String key, String value);
        void clear();
    }

    private final KeyValueStore storage;

    public ConnectionStore(SharedPreferences preferences) {
        this(new PreferencesStore(preferences));
    }

    ConnectionStore(KeyValueStore storage) {
        this.storage = storage;
    }

    public void save(BridgeConfig config, String token, Models.Scope scope) {
        save(config, new Models.PairResult(token, scope));
    }

    public void save(BridgeConfig config, Models.PairResult result) {
        save(config, result, false);
    }

    public void save(BridgeConfig config, Models.PairResult result, boolean preferRelay) {
        if (result == null) throw new IllegalArgumentException("Pair result is missing");
        String token = result.token();
        Models.Scope scope = result.scope();
        String safeToken = token == null ? "" : token.trim();
        if (!safeToken.matches("[a-fA-F0-9]{64}")) {
            throw new IllegalArgumentException("Device token is invalid");
        }
        if (scope == null) {
            throw new IllegalArgumentException("Device scope is missing");
        }
        storage.put(BASE_URL, config.baseUrl());
        storage.put(FINGERPRINT, config.fingerprint());
        storage.put(DEVICE_NAME, config.deviceName());
        storage.put(TOKEN, safeToken);
        storage.put(SCOPE, scope.wireValue());
        Models.WakeRelayConfig relay = result.wakeRelay();
        storage.put(RELAY_BASE_URL, relay == null ? "" : relay.baseUrl());
        storage.put(RELAY_CHANNEL_ID, relay == null ? "" : relay.channelId());
        storage.put(RELAY_SUBSCRIBER_TOKEN, relay == null ? "" : relay.subscriberToken());
        storage.put(RELAY_WAKE_KEY, relay == null ? "" : relay.wakeKey());
        storage.put(RELAY_COMMAND_CHANNEL_ID,
                relay == null || relay.version() < 2 ? "" : relay.commandChannelId());
        storage.put(RELAY_COMMAND_PUBLISHER_TOKEN,
                relay == null || relay.version() < 2 ? "" : relay.commandPublisherToken());
        storage.put(RELAY_COMMAND_KEY,
                relay == null || relay.version() < 2 ? "" : relay.commandKey());
        storage.put(PREFER_RELAY, preferRelay && relay != null && relay.version() == 2
                ? "true"
                : "false");
    }

    public Connection load() {
        String baseUrl = storage.get(BASE_URL);
        String fingerprint = storage.get(FINGERPRINT);
        String deviceName = storage.get(DEVICE_NAME);
        String token = storage.get(TOKEN);
        String scope = storage.get(SCOPE);
        if (isMissing(baseUrl)
                || isMissing(fingerprint)
                || isMissing(deviceName)
                || isMissing(token)
                || isMissing(scope)
                || !token.matches("[a-fA-F0-9]{64}")) {
            return null;
        }
        try {
            Models.WakeRelayConfig relay = loadWakeRelay();
            return new Connection(
                    BridgeConfig.restore(baseUrl, fingerprint, deviceName),
                    token,
                    Models.Scope.fromWire(scope),
                    relay,
                    "true".equals(storage.get(PREFER_RELAY)));
        } catch (IllegalArgumentException error) {
            return null;
        }
    }

    public void clear() {
        storage.clear();
    }

    private static boolean isMissing(String value) {
        return value == null || value.isBlank();
    }

    private Models.WakeRelayConfig loadWakeRelay() {
        String baseUrl = storage.get(RELAY_BASE_URL);
        String channelId = storage.get(RELAY_CHANNEL_ID);
        String subscriberToken = storage.get(RELAY_SUBSCRIBER_TOKEN);
        String wakeKey = storage.get(RELAY_WAKE_KEY);
        String commandChannelId = storage.get(RELAY_COMMAND_CHANNEL_ID);
        String commandPublisherToken = storage.get(RELAY_COMMAND_PUBLISHER_TOKEN);
        String commandKey = storage.get(RELAY_COMMAND_KEY);
        if (isMissing(baseUrl)
                || isMissing(channelId)
                || isMissing(subscriberToken)
                || isMissing(wakeKey)) {
            return null;
        }
        try {
            boolean hasAnyCommand = !isMissing(commandChannelId)
                    || !isMissing(commandPublisherToken)
                    || !isMissing(commandKey);
            if (hasAnyCommand) {
                return new Models.WakeRelayConfig(
                        baseUrl,
                        channelId,
                        subscriberToken,
                        wakeKey,
                        commandChannelId,
                        commandPublisherToken,
                        commandKey);
            }
            return new Models.WakeRelayConfig(baseUrl, channelId, subscriberToken, wakeKey);
        } catch (IllegalArgumentException error) {
            return null;
        }
    }

    public static final class Connection {
        private final BridgeConfig config;
        private final String token;
        private final Models.Scope scope;
        private final Models.WakeRelayConfig wakeRelay;
        private final boolean prefersRelay;

        Connection(
                BridgeConfig config,
                String token,
                Models.Scope scope,
                Models.WakeRelayConfig wakeRelay) {
            this(config, token, scope, wakeRelay, false);
        }

        Connection(
                BridgeConfig config,
                String token,
                Models.Scope scope,
                Models.WakeRelayConfig wakeRelay,
                boolean prefersRelay) {
            this.config = config;
            this.token = token;
            this.scope = scope;
            this.wakeRelay = wakeRelay;
            this.prefersRelay = prefersRelay && wakeRelay != null && wakeRelay.version() == 2;
        }

        public BridgeConfig config() { return config; }
        public String token() { return token; }
        public Models.Scope scope() { return scope; }
        public Models.WakeRelayConfig wakeRelay() { return wakeRelay; }
        public boolean prefersRelay() { return prefersRelay; }
    }

    private static final class PreferencesStore implements KeyValueStore {
        private final SharedPreferences preferences;

        PreferencesStore(SharedPreferences preferences) {
            this.preferences = preferences;
        }

        @Override
        public String get(String key) {
            return preferences.getString(key, null);
        }

        @Override
        public void put(String key, String value) {
            preferences.edit().putString(key, value).apply();
        }

        @Override
        public void clear() {
            preferences.edit().clear().apply();
        }
    }
}
