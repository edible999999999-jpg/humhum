package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class SessionSnapshotCodecTest {
    private static final long NOW_MILLIS = System.currentTimeMillis();
    private static final long SAVED_AT_MILLIS = NOW_MILLIS - 60_000L;

    @Test
    public void roundTripsOnlyTheFiveAllowedSessionFields() throws Exception {
        Models.Session source = new Models.Session(
                "session-private", "codex", "HUMHUM", "waiting",
                "2026-07-12T00:00:00Z", true, true,
                List.of(new Models.Action("approval-private", "codex", "command", "Run tests")));

        byte[] encoded = SessionSnapshotCodec.encode(
                new SessionSnapshot(SAVED_AT_MILLIS, List.of(source)));
        JSONObject payload = new JSONObject(new String(encoded, StandardCharsets.UTF_8));
        JSONObject entry = payload.getJSONArray("sessions").getJSONObject(0);
        SessionSnapshot decoded = SessionSnapshotCodec.decode(encoded);
        Models.Session session = decoded.sessions().get(0);

        assertEquals(3, payload.length());
        assertEquals(1, payload.getInt("version"));
        assertEquals(SAVED_AT_MILLIS, payload.getLong("saved_at_ms"));
        assertEquals(5, entry.length());
        assertEquals("HUMHUM", entry.getString("project"));
        assertEquals("codex", entry.getString("agent"));
        assertEquals("waiting", entry.getString("status"));
        assertEquals("2026-07-12T00:00:00Z", entry.getString("last_activity_at"));
        assertTrue(entry.getBoolean("needs_attention"));
        assertEquals(SAVED_AT_MILLIS, decoded.savedAtMillis());
        assertEquals("HUMHUM", session.project());
        assertEquals("codex", session.agent());
        assertEquals("waiting", session.status());
        assertEquals("2026-07-12T00:00:00Z", session.lastActivityAt());
        assertTrue(session.needsAttention());
        assertEquals("", session.id());
        assertFalse(session.canMessage());
        assertTrue(session.actions().isEmpty());
    }

    @Test
    public void snapshotsExposeAnImmutableSessionList() {
        SessionSnapshot snapshot = new SessionSnapshot(SAVED_AT_MILLIS, List.of(session()));

        assertThrows(UnsupportedOperationException.class,
                () -> snapshot.sessions().add(session()));
    }

    @Test
    public void rejectsMalformedStoredPayloadsInsteadOfTruncatingThem() throws Exception {
        JSONObject payload = validPayload();
        JSONObject entry = payload.getJSONArray("sessions").getJSONObject(0);

        assertInvalid(new JSONObject(payload.toString()).put("private", "leak"));
        assertInvalid(new JSONObject(payload.toString())
                .put("sessions", new JSONArray().put(new JSONObject(entry.toString()).put("private", "leak"))));
        assertInvalid(new JSONObject(payload.toString()).put("sessions", entries(31)));
        assertInvalid(new JSONObject(payload.toString()).put("saved_at_ms", -1));
        assertInvalid(new JSONObject(payload.toString()).put("saved_at_ms", NOW_MILLIS + 60_000L));
        assertInvalid(new JSONObject(payload.toString())
                .put("saved_at_ms", NOW_MILLIS - 7L * 24L * 60L * 60L * 1000L - 1L));
        assertInvalid(payloadWithEntry("project", "p".repeat(161)));
        assertInvalid(payloadWithEntry("agent", "a".repeat(65)));
        assertInvalid(payloadWithEntry("status", "s".repeat(33)));
        assertInvalid(payloadWithEntry("last_activity_at", "t".repeat(65)));
        assertInvalid(payloadWithEntry("needs_attention", "true"));
    }

    @Test
    public void rejectsOversizedLiveSnapshotsInsteadOfTruncatingThem() {
        assertThrows(IllegalArgumentException.class,
                () -> SessionSnapshotCodec.encode(new SessionSnapshot(SAVED_AT_MILLIS, sessions(31))));
        assertThrows(IllegalArgumentException.class,
                () -> SessionSnapshotCodec.encode(new SessionSnapshot(
                        SAVED_AT_MILLIS,
                        List.of(new Models.Session("id", "agent", "p".repeat(161), "idle", "", false,
                                false, List.of())))));
    }

    @Test
    public void formatsOfflineCopyByFreshnessBucketWithoutRawTimestamps() {
        assertEquals("离线快照 · 刚刚", SessionSnapshotCodec.ageCopy(NOW_MILLIS, NOW_MILLIS));
        assertEquals("离线快照 · 1 分钟前",
                SessionSnapshotCodec.ageCopy(NOW_MILLIS - 60_000L, NOW_MILLIS));
        assertEquals("离线快照 · 1 小时前",
                SessionSnapshotCodec.ageCopy(NOW_MILLIS - 60L * 60L * 1000L, NOW_MILLIS));
        assertEquals("离线快照 · 1 天前",
                SessionSnapshotCodec.ageCopy(NOW_MILLIS - 24L * 60L * 60L * 1000L, NOW_MILLIS));
    }

    private static void assertInvalid(JSONObject payload) {
        assertThrows(IllegalArgumentException.class,
                () -> SessionSnapshotCodec.decode(payload.toString().getBytes(StandardCharsets.UTF_8)));
    }

    private static JSONObject validPayload() throws Exception {
        return new JSONObject()
                .put("version", 1)
                .put("saved_at_ms", SAVED_AT_MILLIS)
                .put("sessions", entries(1));
    }

    private static JSONObject payloadWithEntry(String key, Object value) throws Exception {
        JSONObject payload = validPayload();
        payload.getJSONArray("sessions").getJSONObject(0).put(key, value);
        return payload;
    }

    private static JSONArray entries(int count) throws Exception {
        JSONArray entries = new JSONArray();
        for (Models.Session session : sessions(count)) {
            entries.put(new JSONObject()
                    .put("project", session.project())
                    .put("agent", session.agent())
                    .put("status", session.status())
                    .put("last_activity_at", session.lastActivityAt())
                    .put("needs_attention", session.needsAttention()));
        }
        return entries;
    }

    private static List<Models.Session> sessions(int count) {
        List<Models.Session> sessions = new ArrayList<>();
        for (int index = 0; index < count; index++) {
            sessions.add(session());
        }
        return sessions;
    }

    private static Models.Session session() {
        return new Models.Session("id", "agent", "project", "idle", "", false, false, List.of());
    }
}
