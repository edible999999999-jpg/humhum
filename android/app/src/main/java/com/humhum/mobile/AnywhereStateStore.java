package com.humhum.mobile;

import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public final class AnywhereStateStore {
    private static final String DOWNLINK = "downlink";
    private static final String UPLINK = "uplink";
    private static final String PENDING = "pending";
    private static final String RESPONSE = "response";
    private static final int MAX_RESPONSES = 16;
    private static final Object PROCESS_LOCK = new Object();

    interface KeyValueStore {
        String get(String key);
        void put(String key, String value);
        void putPair(String firstKey, String firstValue, String secondKey, String secondValue);
        void remove(String key);
        void clear();
    }

    private final KeyValueStore storage;

    public AnywhereStateStore(SharedPreferences preferences) {
        this(new PreferencesStore(preferences));
    }

    AnywhereStateStore(KeyValueStore storage) {
        if (storage == null) throw new IllegalArgumentException("Anywhere state is missing");
        this.storage = storage;
    }

    public synchronized long downlinkSequence(Models.WakeRelayConfig relay) {
        synchronized (PROCESS_LOCK) {
            return sequenceFor(DOWNLINK, requireV2(relay).channelId());
        }
    }

    public synchronized void advanceDownlink(Models.WakeRelayConfig relay, long sequence) {
        synchronized (PROCESS_LOCK) {
            Models.WakeRelayConfig safe = requireV2(relay);
            long previous = sequenceFor(DOWNLINK, safe.channelId());
            if (sequence == previous) return;
            if (sequence < previous) {
                throw new IllegalStateException("Anywhere downlink moved backward");
            }
            storage.put(DOWNLINK, encodedSequence(safe.channelId(), sequence));
        }
    }

    public synchronized long nextUplinkSequence(Models.WakeRelayConfig relay) {
        long previous = sequenceFor(UPLINK, requireV2(relay).commandChannelId());
        if (previous == Long.MAX_VALUE) throw new IllegalStateException("Anywhere uplink is exhausted");
        return previous + 1;
    }

    public synchronized void completeUplink(Models.WakeRelayConfig relay, long sequence) {
        Models.WakeRelayConfig safe = requireV2(relay);
        if (sequence != nextUplinkSequence(safe)) {
            throw new IllegalStateException("Anywhere uplink sequence changed");
        }
        storage.put(UPLINK, encodedSequence(safe.commandChannelId(), sequence));
    }

    public synchronized void savePending(
            Models.WakeRelayConfig relay,
            String requestId,
            String bodyDigest,
            AnywhereEnvelope envelope) throws JSONException {
        Models.WakeRelayConfig safe = requireV2(relay);
        if (requestId == null
                || !requestId.matches("[a-f0-9]{32}")
                || bodyDigest == null
                || !bodyDigest.matches("[a-f0-9]{64}")
                || envelope == null
                || envelope.sequence() != nextUplinkSequence(safe)) {
            throw new IllegalArgumentException("Anywhere pending request is invalid");
        }
        JSONObject payload = new JSONObject()
                .put("channel", safe.commandChannelId())
                .put("request_id", requestId)
                .put("body_digest", bodyDigest)
                .put("envelope", new JSONObject(envelope.toJson()));
        storage.put(PENDING, payload.toString());
    }

    public synchronized Pending pending(Models.WakeRelayConfig relay) {
        Models.WakeRelayConfig safe = requireV2(relay);
        String payload = storage.get(PENDING);
        if (payload == null || payload.isBlank()) return null;
        try {
            JSONObject root = new JSONObject(payload);
            if (root.length() != 4
                    || !safe.commandChannelId().equals(root.getString("channel"))) return null;
            String requestId = root.getString("request_id");
            String bodyDigest = root.getString("body_digest");
            JSONObject raw = root.getJSONObject("envelope");
            if (!requestId.matches("[a-f0-9]{32}")
                    || !bodyDigest.matches("[a-f0-9]{64}")
                    || raw.length() != 4) return null;
            AnywhereEnvelope envelope = new AnywhereEnvelope(
                    raw.getInt("version"),
                    raw.getLong("sequence"),
                    raw.getString("nonce"),
                    raw.getString("ciphertext"));
            if (envelope.version() != 1 || envelope.sequence() != nextUplinkSequence(safe)) {
                return null;
            }
            return new Pending(requestId, bodyDigest, envelope);
        } catch (JSONException | IllegalArgumentException error) {
            return null;
        }
    }

    public synchronized void completePending(Models.WakeRelayConfig relay) {
        Pending pending = pending(relay);
        if (pending == null) throw new IllegalStateException("Anywhere request is not pending");
        completeUplink(relay, pending.envelope().sequence());
        storage.remove(PENDING);
    }

    public synchronized void saveResponse(
            Models.WakeRelayConfig relay, String requestId, JSONObject body) throws JSONException {
        synchronized (PROCESS_LOCK) {
            Models.WakeRelayConfig safe = requireV2(relay);
            storage.put(RESPONSE, responsePayload(safe, requestId, body));
        }
    }

    public synchronized void saveResponseAndAdvance(
            Models.WakeRelayConfig relay,
            long sequence,
            String requestId,
            JSONObject body) throws JSONException {
        synchronized (PROCESS_LOCK) {
            Models.WakeRelayConfig safe = requireV2(relay);
            long previous = sequenceFor(DOWNLINK, safe.channelId());
            if (sequence == previous) return;
            if (sequence < previous) {
                throw new IllegalStateException("Anywhere downlink moved backward");
            }
            storage.putPair(
                    RESPONSE,
                    responsePayload(safe, requestId, body),
                    DOWNLINK,
                    encodedSequence(safe.channelId(), sequence));
        }
    }

    private String responsePayload(
            Models.WakeRelayConfig safe, String requestId, JSONObject body) throws JSONException {
        if (requestId == null || !requestId.matches("[a-f0-9]{32}") || body == null) {
            throw new IllegalArgumentException("Anywhere response is invalid");
        }
        JSONArray responses = responseArray(safe.channelId());
        JSONArray next = new JSONArray();
        for (int index = Math.max(0, responses.length() - MAX_RESPONSES + 1);
                index < responses.length(); index++) {
            JSONObject item = responses.optJSONObject(index);
            if (item != null && !requestId.equals(item.optString("request_id"))) next.put(item);
        }
        next.put(new JSONObject()
                .put("request_id", requestId)
                .put("body", new JSONObject(body.toString())));
        return new JSONObject()
                .put("channel", safe.channelId())
                .put("responses", next)
                .toString();
    }

    public synchronized JSONObject takeResponse(
            Models.WakeRelayConfig relay, String requestId) {
        synchronized (PROCESS_LOCK) {
            Models.WakeRelayConfig safe = requireV2(relay);
            JSONArray responses = responseArray(safe.channelId());
            JSONArray remaining = new JSONArray();
            JSONObject found = null;
            for (int index = 0; index < responses.length(); index++) {
                JSONObject item = responses.optJSONObject(index);
                if (item == null) continue;
                if (found == null && requestId.equals(item.optString("request_id"))) {
                    found = item.optJSONObject("body");
                } else {
                    remaining.put(item);
                }
            }
            try {
                if (remaining.length() == 0) storage.remove(RESPONSE);
                else storage.put(RESPONSE, new JSONObject()
                        .put("channel", safe.channelId())
                        .put("responses", remaining)
                        .toString());
            } catch (JSONException error) {
                storage.remove(RESPONSE);
            }
            return found;
        }
    }

    private JSONArray responseArray(String channel) {
        String payload = storage.get(RESPONSE);
        if (payload == null || payload.isBlank()) return new JSONArray();
        try {
            JSONObject root = new JSONObject(payload);
            if (root.length() != 2 || !channel.equals(root.getString("channel"))) {
                return new JSONArray();
            }
            return root.getJSONArray("responses");
        } catch (JSONException error) {
            storage.remove(RESPONSE);
            return new JSONArray();
        }
    }

    public synchronized void clear() {
        storage.clear();
    }

    private long sequenceFor(String key, String channel) {
        String value = storage.get(key);
        if (value == null || value.length() < 66 || value.charAt(64) != ':') return 0;
        if (!channel.equals(value.substring(0, 64))) return 0;
        String raw = value.substring(65);
        if (!raw.matches("[0-9]{1,19}")) return 0;
        try {
            return Math.max(0, Long.parseLong(raw));
        } catch (NumberFormatException error) {
            return 0;
        }
    }

    private static String encodedSequence(String channel, long sequence) {
        if (sequence <= 0) throw new IllegalArgumentException("Anywhere sequence is invalid");
        return channel + ":" + sequence;
    }

    private static Models.WakeRelayConfig requireV2(Models.WakeRelayConfig relay) {
        if (relay == null || relay.version() != 2) {
            throw new IllegalArgumentException("Anywhere relay is unavailable");
        }
        return relay;
    }

    public static final class Pending {
        private final String requestId;
        private final String bodyDigest;
        private final AnywhereEnvelope envelope;

        Pending(String requestId, String bodyDigest, AnywhereEnvelope envelope) {
            this.requestId = requestId;
            this.bodyDigest = bodyDigest;
            this.envelope = envelope;
        }

        public String requestId() { return requestId; }
        public String bodyDigest() { return bodyDigest; }
        public AnywhereEnvelope envelope() { return envelope; }
    }

    private static final class PreferencesStore implements KeyValueStore {
        private final SharedPreferences preferences;

        PreferencesStore(SharedPreferences preferences) {
            this.preferences = preferences;
        }

        @Override public String get(String key) { return preferences.getString(key, null); }
        @Override public void put(String key, String value) {
            if (!preferences.edit().putString(key, value).commit()) {
                throw new IllegalStateException("Could not persist Anywhere state");
            }
        }
        @Override public void putPair(
                String firstKey, String firstValue, String secondKey, String secondValue) {
            if (!preferences.edit()
                    .putString(firstKey, firstValue)
                    .putString(secondKey, secondValue)
                    .commit()) {
                throw new IllegalStateException("Could not persist Anywhere state");
            }
        }
        @Override public void remove(String key) {
            if (!preferences.edit().remove(key).commit()) {
                throw new IllegalStateException("Could not persist Anywhere state");
            }
        }
        @Override public void clear() {
            if (!preferences.edit().clear().commit()) {
                throw new IllegalStateException("Could not clear Anywhere state");
            }
        }
    }
}
