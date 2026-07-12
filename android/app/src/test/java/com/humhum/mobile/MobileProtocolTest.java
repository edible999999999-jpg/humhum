package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

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
    public void disconnectRevokesTheCurrentPairedDevice() {
        MobileProtocol.RequestSpec request = MobileProtocol.disconnectRequest();

        assertEquals("DELETE", request.method());
        assertEquals("/api/device", request.path());
        assertTrue(request.requiresToken());
        assertEquals("", request.body());
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
                    .put("pending_actions", actions));
        }
        String payload = new JSONObject().put("scope", "control").put("sessions", sessions).toString();

        Models.SessionPage control = MobileProtocol.parseSessions(payload);
        assertEquals(Models.Scope.CONTROL, control.scope());
        assertEquals(30, control.sessions().size());
        assertEquals(20, control.sessions().get(0).actions().size());
        assertTrue(control.sessions().get(0).canMessage());

        String readPayload = new JSONObject(payload).put("scope", "read").toString();
        Models.SessionPage read = MobileProtocol.parseSessions(readPayload);
        assertEquals(Models.Scope.READ, read.scope());
        assertTrue(read.sessions().get(0).actions().isEmpty());
        assertFalse(read.sessions().get(0).canMessage());
    }

    private static BridgeConfig config() {
        return BridgeConfig.parse(
                "https://192.168.1.20:31276",
                "A1B2C3D4",
                "AA".repeat(32),
                "Xiaomi 14");
    }
}
