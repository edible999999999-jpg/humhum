package com.humhum.mobile;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public final class SessionSnapshotCodec {
    private static final int VERSION = 1;
    private static final int MAX_PAYLOAD_BYTES = 256 * 1024;
    private static final int MAX_SESSIONS = 30;
    private static final int MAX_PROJECT_LENGTH = 160;
    private static final int MAX_AGENT_LENGTH = 64;
    private static final int MAX_STATUS_LENGTH = 32;
    private static final int MAX_LAST_ACTIVITY_LENGTH = 64;
    private static final long MAX_AGE_MILLIS = 7L * 24L * 60L * 60L * 1000L;

    private SessionSnapshotCodec() {}

    public static byte[] encode(SessionSnapshot snapshot) {
        if (snapshot == null) throw new IllegalArgumentException("Snapshot is missing");
        validateSavedAt(snapshot.savedAtMillis(), System.currentTimeMillis());
        List<Models.Session> sessions = snapshot.sessions();
        if (sessions.size() > MAX_SESSIONS) throw new IllegalArgumentException("Snapshot is too large");
        try {
            JSONArray entries = new JSONArray();
            for (Models.Session session : sessions) {
                if (session == null) throw new IllegalArgumentException("Snapshot session is invalid");
                entries.put(new JSONObject()
                        .put("project", bounded(session.project(), MAX_PROJECT_LENGTH))
                        .put("agent", bounded(session.agent(), MAX_AGENT_LENGTH))
                        .put("status", bounded(session.status(), MAX_STATUS_LENGTH))
                        .put("last_activity_at", bounded(session.lastActivityAt(), MAX_LAST_ACTIVITY_LENGTH))
                        .put("needs_attention", session.needsAttention()));
            }
            byte[] encoded = new JSONObject()
                    .put("version", VERSION)
                    .put("saved_at_ms", snapshot.savedAtMillis())
                    .put("sessions", entries)
                    .toString()
                    .getBytes(StandardCharsets.UTF_8);
            if (encoded.length > MAX_PAYLOAD_BYTES) {
                throw new IllegalArgumentException("Snapshot payload is too large");
            }
            return encoded;
        } catch (JSONException error) {
            throw new IllegalArgumentException("Snapshot payload is invalid", error);
        }
    }

    public static SessionSnapshot decode(byte[] payload) {
        if (payload == null || payload.length == 0 || payload.length > MAX_PAYLOAD_BYTES) {
            throw new IllegalArgumentException("Snapshot payload is invalid");
        }
        try {
            JSONObject root = new JSONObject(strictUtf8(payload));
            if (root.length() != 3
                    || !root.has("version")
                    || !root.has("saved_at_ms")
                    || !root.has("sessions")
                    || strictInt(root, "version") != VERSION
                    || !(root.get("sessions") instanceof JSONArray)) {
                throw new IllegalArgumentException("Snapshot payload is invalid");
            }
            long savedAtMillis = strictLong(root, "saved_at_ms");
            validateSavedAt(savedAtMillis, System.currentTimeMillis());
            JSONArray entries = root.getJSONArray("sessions");
            if (entries.length() > MAX_SESSIONS) {
                throw new IllegalArgumentException("Snapshot is too large");
            }
            List<Models.Session> sessions = new ArrayList<>();
            for (int index = 0; index < entries.length(); index++) {
                Object value = entries.get(index);
                if (!(value instanceof JSONObject)) {
                    throw new IllegalArgumentException("Snapshot session is invalid");
                }
                JSONObject entry = (JSONObject) value;
                if (entry.length() != 5
                        || !entry.has("project")
                        || !entry.has("agent")
                        || !entry.has("status")
                        || !entry.has("last_activity_at")
                        || !entry.has("needs_attention")) {
                    throw new IllegalArgumentException("Snapshot session is invalid");
                }
                Object attention = entry.get("needs_attention");
                if (!(attention instanceof Boolean)) {
                    throw new IllegalArgumentException("Snapshot session is invalid");
                }
                sessions.add(new Models.Session(
                        "",
                        bounded(entry, "agent", MAX_AGENT_LENGTH),
                        bounded(entry, "project", MAX_PROJECT_LENGTH),
                        bounded(entry, "status", MAX_STATUS_LENGTH),
                        bounded(entry, "last_activity_at", MAX_LAST_ACTIVITY_LENGTH),
                        (Boolean) attention,
                        false,
                        List.of()));
            }
            SessionSnapshot snapshot = new SessionSnapshot(savedAtMillis, sessions);
            if (!Arrays.equals(payload, encode(snapshot))) {
                throw new IllegalArgumentException("Snapshot payload is not canonical");
            }
            return snapshot;
        } catch (JSONException error) {
            throw new IllegalArgumentException("Snapshot payload is invalid", error);
        }
    }

    public static String ageCopy(long savedAtMillis, long nowMillis) {
        long ageMillis = nowMillis > savedAtMillis ? nowMillis - savedAtMillis : 0L;
        if (ageMillis < 60_000L) return "离线快照 · 刚刚";
        if (ageMillis < 60L * 60L * 1000L) return "离线快照 · " + ageMillis / 60_000L + " 分钟前";
        if (ageMillis < 24L * 60L * 60L * 1000L) {
            return "离线快照 · " + ageMillis / (60L * 60L * 1000L) + " 小时前";
        }
        return "离线快照 · " + ageMillis / (24L * 60L * 60L * 1000L) + " 天前";
    }

    private static int strictInt(JSONObject object, String key) throws JSONException {
        Object value = object.get(key);
        if (!(value instanceof Integer)) throw new IllegalArgumentException("Snapshot value is invalid");
        return (Integer) value;
    }

    private static long strictLong(JSONObject object, String key) throws JSONException {
        Object value = object.get(key);
        if (!(value instanceof Integer) && !(value instanceof Long)) {
            throw new IllegalArgumentException("Snapshot value is invalid");
        }
        return ((Number) value).longValue();
    }

    private static String bounded(JSONObject object, String key, int maximum) throws JSONException {
        Object value = object.get(key);
        if (!(value instanceof String)) throw new IllegalArgumentException("Snapshot text is invalid");
        return bounded((String) value, maximum);
    }

    private static String bounded(String value, int maximum) {
        if (value == null || value.length() > maximum) {
            throw new IllegalArgumentException("Snapshot text is invalid");
        }
        return value;
    }

    private static void validateSavedAt(long savedAtMillis, long nowMillis) {
        if (savedAtMillis <= 0 || nowMillis <= 0 || savedAtMillis > nowMillis) {
            throw new IllegalArgumentException("Snapshot time is invalid");
        }
        if (nowMillis - savedAtMillis > MAX_AGE_MILLIS) {
            throw new IllegalArgumentException("Snapshot has expired");
        }
    }

    private static String strictUtf8(byte[] value) {
        try {
            return StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(value))
                    .toString();
        } catch (CharacterCodingException error) {
            throw new IllegalArgumentException("Snapshot payload is not UTF-8", error);
        }
    }
}
