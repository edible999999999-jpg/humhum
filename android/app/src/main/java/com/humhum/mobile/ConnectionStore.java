package com.humhum.mobile;

import android.content.SharedPreferences;

public final class ConnectionStore {
    private static final String BASE_URL = "base_url";
    private static final String FINGERPRINT = "fingerprint";
    private static final String DEVICE_NAME = "device_name";
    private static final String TOKEN = "token";
    private static final String SCOPE = "scope";

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
            return new Connection(
                    BridgeConfig.restore(baseUrl, fingerprint, deviceName),
                    token,
                    Models.Scope.fromWire(scope));
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

    public static final class Connection {
        private final BridgeConfig config;
        private final String token;
        private final Models.Scope scope;

        Connection(BridgeConfig config, String token, Models.Scope scope) {
            this.config = config;
            this.token = token;
            this.scope = scope;
        }

        public BridgeConfig config() { return config; }
        public String token() { return token; }
        public Models.Scope scope() { return scope; }
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
