package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class MobileProtocolTest {
    @Test
    public void pairingUsesTheExistingPairEndpoint() throws Exception {
        BridgeConfig config = config();

        MobileProtocol.RequestSpec request = MobileProtocol.pairRequest(config);

        assertEquals("POST", request.method());
        assertEquals("/api/pair", request.path());
        assertFalse(request.requiresToken());
        JSONObject body = new JSONObject(request.body());
        assertEquals("A1B2C3D4", body.getString("code"));
        assertEquals("Xiaomi 14", body.getString("device_name"));
    }

    @Test
    public void pairingParsesOptionalSubscriberOnlyWakeRelay() throws Exception {
        JSONObject relay = new JSONObject()
                .put("version", 1)
                .put("base_url", "https://relay.example.com")
                .put("channel_id", "11".repeat(32))
                .put("subscriber_token", "22".repeat(32))
                .put("wake_key", "33".repeat(32));
        JSONObject payload = new JSONObject()
                .put("token", "ab".repeat(32))
                .put("scope", "control")
                .put("wake_relay", relay);

        Models.PairResult result = MobileProtocol.parsePairResult(payload.toString());

        assertEquals(Models.Scope.CONTROL, result.scope());
        assertEquals("https://relay.example.com", result.wakeRelay().baseUrl());
        assertEquals("22".repeat(32), result.wakeRelay().subscriberToken());
        assertThrows(org.json.JSONException.class, () -> MobileProtocol.parsePairResult(
                new JSONObject(payload.toString())
                        .put("wake_relay", new JSONObject(relay.toString())
                                .put("publisher_token", "44".repeat(32)))
                        .toString()));
        assertThrows(org.json.JSONException.class, () -> MobileProtocol.parsePairResult(
                new JSONObject(payload.toString())
                        .put("wake_relay", new JSONObject(relay.toString()).put("version", "1"))
                        .toString()));
    }

    @Test
    public void legacyPairResponseHasNoWakeRelay() throws Exception {
        Models.PairResult result = MobileProtocol.parsePairResult(new JSONObject()
                .put("token", "ab".repeat(32))
                .put("scope", "read")
                .toString());

        assertEquals(Models.Scope.READ, result.scope());
        assertEquals(null, result.wakeRelay());
    }

    @Test
    public void approvalsSelectCodexOrHookEndpoints() throws Exception {
        Models.Action codex = new Models.Action("approval-1", "codex", "command", "Run tests");
        Models.Action claude = new Models.Action("event-1", "claude", "Bash", "Build app");

        MobileProtocol.RequestSpec codexRequest = MobileProtocol.approvalRequest(
                codex, "allow_once", Models.Scope.CONTROL);
        MobileProtocol.RequestSpec hookRequest = MobileProtocol.approvalRequest(
                claude, "deny", Models.Scope.CONTROL);

        assertEquals("/api/codex/approval", codexRequest.path());
        assertEquals("approval-1", new JSONObject(codexRequest.body()).getString("approval_id"));
        assertEquals("/api/hook/permission", hookRequest.path());
        assertEquals("event-1", new JSONObject(hookRequest.body()).getString("event_id"));
        assertThrows(IllegalStateException.class,
                () -> MobileProtocol.approvalRequest(codex, "allow_once", Models.Scope.READ));
    }

    @Test
    public void followUpUsesProviderAwareSessionEndpoint() throws Exception {
        Models.Session session = new Models.Session(
                "session-1", "claude-code", "humhum", "active", "2026-07-12T00:00:00Z",
                false, true, java.util.List.of());

        MobileProtocol.RequestSpec request = MobileProtocol.messageRequest(
                session, "  summarize the result  ", Models.Scope.CONTROL);

        assertEquals("/api/session/message", request.path());
        JSONObject body = new JSONObject(request.body());
        assertEquals("session-1", body.getString("session_id"));
        assertEquals("claude-code", body.getString("provider"));
        assertEquals("summarize the result", body.getString("message"));
        assertThrows(IllegalStateException.class,
                () -> MobileProtocol.messageRequest(session, "hello", Models.Scope.READ));
    }

    @Test
    public void recentConversationUsesExactAuthenticatedSessionOnlyRequest() throws Exception {
        Models.Session session = MobileProtocol.parseSessions(new JSONObject()
                .put("scope", "read")
                .put("sessions", new JSONArray().put(new JSONObject()
                        .put("id", "session-1")
                        .put("agent", "codex")
                        .put("project", "humhum")
                        .put("status", "active")
                        .put("last_activity_at", "2026-07-12T00:00:00Z")
                        .put("needs_attention", false)
                        .put("can_message", false)
                        .put("can_read_conversation", true)))
                .toString())
                .sessions()
                .get(0);

        MobileProtocol.RequestSpec request = MobileProtocol.conversationRequest(session);

        assertTrue(session.canReadConversation());
        assertEquals("POST", request.method());
        assertEquals("/api/session/conversation", request.path());
        assertTrue(request.requiresToken());
        assertEquals(65_536, request.maxResponseBytes());
        JSONObject body = new JSONObject(request.body());
        assertEquals(1, body.length());
        assertEquals("session-1", body.getString("session_id"));
        assertThrows(IllegalArgumentException.class, () -> MobileProtocol.conversationRequest(
                new Models.Session(
                        "session-2",
                        "codex",
                        "humhum",
                        "active",
                        "2026-07-12T00:00:00Z",
                        false,
                        false,
                        java.util.List.of())));
    }

    @Test
    public void boundedReaderRejectsConversationResponseAboveRawByteLimit() {
        byte[] paddedPayload = (" ".repeat(65_536) + "{}")
                .getBytes(StandardCharsets.UTF_8);

        assertThrows(IOException.class, () -> MobileProtocol.readBounded(
                new ByteArrayInputStream(paddedPayload), 65_536));
    }

    @Test
    public void disconnectRevokesTheCurrentPairedDevice() {
        MobileProtocol.RequestSpec request = MobileProtocol.disconnectRequest();

        assertEquals("DELETE", request.method());
        assertEquals("/api/device", request.path());
        assertTrue(request.requiresToken());
        assertEquals("", request.body());
    }

    @Test
    public void presenceUsesExactAuthenticatedModesAndRoute() throws Exception {
        MobileProtocol.RequestSpec foreground = MobileProtocol.presenceRequest(
                MobileProtocol.PresenceMode.FOREGROUND);
        MobileProtocol.RequestSpec monitoring = MobileProtocol.presenceRequest(
                MobileProtocol.PresenceMode.MONITORING);

        assertEquals("POST", foreground.method());
        assertEquals("/api/presence", foreground.path());
        assertTrue(foreground.requiresToken());
        assertEquals("foreground", new JSONObject(foreground.body()).getString("mode"));
        assertEquals("monitoring", new JSONObject(monitoring.body()).getString("mode"));
        assertEquals(1, new JSONObject(foreground.body()).length());
        assertThrows(IllegalArgumentException.class, () -> MobileProtocol.presenceRequest(null));
    }

    @Test
    public void onlyLegacyNotFoundDisablesPresenceReporting() {
        assertTrue(MobileProtocol.isPresenceUnsupported(404));
        assertFalse(MobileProtocol.isPresenceUnsupported(400));
        assertFalse(MobileProtocol.isPresenceUnsupported(401));
        assertFalse(MobileProtocol.isPresenceUnsupported(500));
    }

    @Test
    public void parsingIsBoundedAndReadScopeRemovesControls() throws Exception {
        JSONArray sessions = new JSONArray();
        for (int index = 0; index < 35; index++) {
            JSONArray actions = new JSONArray();
            for (int action = 0; action < 25; action++) {
                actions.put(new JSONObject()
                        .put("id", "approval-" + action)
                        .put("provider", "codex")
                        .put("operation", "command")
                        .put("summary", "safe summary"));
            }
            sessions.put(new JSONObject()
                    .put("id", "session-" + index)
                    .put("agent", "codex")
                    .put("project", "Project " + index)
                    .put("status", "waiting")
                    .put("last_activity_at", "2026-07-12T00:00:00Z")
                    .put("needs_attention", true)
                    .put("can_message", true)
                    .put("can_read_conversation", true)
                    .put("pending_actions", actions));
        }
        String payload = new JSONObject().put("scope", "control").put("sessions", sessions).toString();

        Models.SessionPage control = MobileProtocol.parseSessions(payload);
        assertEquals(Models.Scope.CONTROL, control.scope());
        assertEquals(30, control.sessions().size());
        assertEquals(20, control.sessions().get(0).actions().size());
        assertTrue(control.sessions().get(0).canMessage());
        assertTrue(control.sessions().get(0).canReadConversation());

        String readPayload = new JSONObject(payload).put("scope", "read").toString();
        Models.SessionPage read = MobileProtocol.parseSessions(readPayload);
        assertEquals(Models.Scope.READ, read.scope());
        assertTrue(read.sessions().get(0).actions().isEmpty());
        assertFalse(read.sessions().get(0).canMessage());
        assertTrue(read.sessions().get(0).canReadConversation());

        String stringBooleanPayload = new JSONObject()
                .put("scope", "read")
                .put("sessions", new JSONArray().put(new JSONObject()
                        .put("id", "session-string-boolean")
                        .put("agent", "codex")
                        .put("can_read_conversation", "true")))
                .toString();
        assertFalse(MobileProtocol.parseSessions(stringBooleanPayload)
                .sessions().get(0).canReadConversation());
    }

    @Test
    public void sessionCursorAcceptsOnlyLowercaseSha256() throws Exception {
        String cursor = "ab".repeat(32);
        JSONObject payload = new JSONObject()
                .put("scope", "read")
                .put("sessions", new JSONArray())
                .put("cursor", cursor);

        assertEquals(cursor, MobileProtocol.parseSessions(payload.toString()).cursor());
        assertEquals("", MobileProtocol.parseSessions(
                new JSONObject(payload.toString()).put("cursor", "ABC").toString()).cursor());
    }

    @Test
    public void eventWaitUsesExactAuthenticatedRouteAndLongReadTimeout() {
        String cursor = "cd".repeat(32);

        MobileProtocol.RequestSpec request = MobileProtocol.eventRequest(cursor);

        assertEquals("GET", request.method());
        assertEquals("/api/events?cursor=" + cursor, request.path());
        assertTrue(request.requiresToken());
        assertEquals(25_000, request.readTimeoutMillis());
        assertThrows(IllegalArgumentException.class, () -> MobileProtocol.eventRequest("bad"));
        assertThrows(IllegalArgumentException.class,
                () -> MobileProtocol.eventRequest(cursor.toUpperCase()));
    }

    @Test
    public void eventSignalParserAcceptsOnlyMinimalBoundedMetadata() throws Exception {
        String cursor = "ef".repeat(32);
        String payload = new JSONObject()
                .put("cursor", cursor)
                .put("changed", true)
                .put("retry_after_ms", 0)
                .toString();

        Models.EventSignal signal = MobileProtocol.parseEventSignal(payload);

        assertEquals(cursor, signal.cursor());
        assertTrue(signal.changed());
        assertThrows(org.json.JSONException.class, () -> MobileProtocol.parseEventSignal(
                new JSONObject(payload).put("session", "private").toString()));
        assertThrows(org.json.JSONException.class, () -> MobileProtocol.parseEventSignal(
                new JSONObject(payload).put("cursor", "bad").toString()));
        assertThrows(org.json.JSONException.class, () -> MobileProtocol.parseEventSignal(
                new JSONObject(payload).put("changed", "true").toString()));
    }

    @Test
    public void recentConversationParserAcceptsOnlyExactBoundedTranscriptPayload() throws Exception {
        JSONArray messages = new JSONArray();
        for (int index = 0; index < 12; index++) {
            messages.put(new JSONObject()
                    .put("role", index % 2 == 0 ? "user" : "assistant")
                    .put("text", index == 11 ? "x".repeat(500) : "message " + index));
        }
        String payload = new JSONObject()
                .put("session_id", "session-1")
                .put("messages", messages)
                .toString();

        List<Models.ConversationMessage> conversation = MobileProtocol.parseConversation(
                payload, "session-1");

        assertEquals(12, conversation.size());
        assertEquals(Models.ConversationRole.USER, conversation.get(0).role());
        assertEquals("message 0", conversation.get(0).text());
        assertEquals(Models.ConversationRole.ASSISTANT, conversation.get(1).role());
        assertEquals("x".repeat(500), conversation.get(11).text());

        assertThrows(org.json.JSONException.class, () -> MobileProtocol.parseConversation(
                new JSONObject(payload).put("trace", "private").toString(),
                "session-1"));
        assertThrows(org.json.JSONException.class, () -> MobileProtocol.parseConversation(
                new JSONObject(payload)
                        .put("session_id", "session-2")
                        .toString(),
                "session-1"));
        assertThrows(org.json.JSONException.class, () -> MobileProtocol.parseConversation(
                new JSONObject(payload)
                        .put("messages", new JSONArray(messages.toString()).put(new JSONObject()
                                .put("role", "user")
                                .put("text", "overflow")))
                        .toString(),
                "session-1"));
        assertThrows(org.json.JSONException.class, () -> MobileProtocol.parseConversation(
                new JSONObject(payload)
                        .put("messages", new JSONArray().put(new JSONObject()
                                .put("role", "system")
                                .put("text", "bad role")))
                        .toString(),
                "session-1"));
        assertThrows(org.json.JSONException.class, () -> MobileProtocol.parseConversation(
                new JSONObject(payload)
                        .put("messages", new JSONArray().put(new JSONObject()
                                .put("role", "user")
                                .put("text", "x".repeat(501))))
                        .toString(),
                "session-1"));
        assertThrows(org.json.JSONException.class, () -> MobileProtocol.parseConversation(
                new JSONObject(payload)
                        .put("messages", new JSONArray().put(new JSONObject()
                                .put("role", "user")
                                .put("text", "ok")
                                .put("path", "/Users/yxguo/private")))
                        .toString(),
                "session-1"));
    }

    @Test
    public void recentConversationParserRejectsRawPayloadsOver64KiBBeforeParsing() throws Exception {
        String basePayload = new JSONObject()
                .put("session_id", "session-1")
                .put("messages", new JSONArray())
                .toString();
        int baseBytes = basePayload.getBytes(StandardCharsets.UTF_8).length;
        String exactPayload = basePayload + " ".repeat(65_536 - baseBytes);
        String oversizedPayload = exactPayload + " ";

        assertEquals(65_536, exactPayload.getBytes(StandardCharsets.UTF_8).length);
        assertEquals(65_537, oversizedPayload.getBytes(StandardCharsets.UTF_8).length);
        assertEquals(List.of(), MobileProtocol.parseConversation(exactPayload, "session-1"));
        assertThrows(
                org.json.JSONException.class,
                () -> MobileProtocol.parseConversation(oversizedPayload, "session-1"));
    }

    private static BridgeConfig config() {
        return BridgeConfig.parse(
                "https://192.168.1.20:31276",
                "A1B2C3D4",
                "AA".repeat(32),
                "Xiaomi 14");
    }
}
