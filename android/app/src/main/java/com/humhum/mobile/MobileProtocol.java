package com.humhum.mobile;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public final class MobileProtocol {
    private static final int MAX_RESPONSE_BYTES = 1_048_576;
    private static final int MAX_SESSIONS = 30;
    private static final int MAX_ACTIONS = 20;
    private static final Set<String> MESSAGE_PROVIDERS = Set.of("codex", "claude", "claude-code", "opencode");

    private final BridgeConfig config;
    private final String token;
    private final Models.Scope scope;

    public enum PresenceMode {
        FOREGROUND("foreground"),
        MONITORING("monitoring");

        private final String wireValue;

        PresenceMode(String wireValue) {
            this.wireValue = wireValue;
        }
    }

    public MobileProtocol(BridgeConfig config, String token, Models.Scope scope) {
        this.config = config;
        this.token = token == null ? "" : token.trim();
        this.scope = scope == null ? Models.Scope.READ : scope;
    }

    public Models.PairResult pair() throws IOException, JSONException {
        JSONObject response = new JSONObject(execute(pairRequest(config)));
        String pairedToken = response.optString("token", "");
        if (!pairedToken.matches("[a-fA-F0-9]{64}")) {
            throw new IOException("HUMHUM returned an invalid device token");
        }
        return new Models.PairResult(pairedToken, Models.Scope.fromWire(response.optString("scope")));
    }

    public Models.SessionPage sessions() throws IOException, JSONException {
        return parseSessions(execute(new RequestSpec("GET", "/api/sessions", "", true)));
    }

    public Models.EventSignal waitForChange(String cursor) throws IOException, JSONException {
        return parseEventSignal(execute(eventRequest(cursor)));
    }

    public void resolveApproval(Models.Action action, String decision) throws IOException, JSONException {
        execute(approvalRequest(action, decision, scope));
    }

    public String sendMessage(Models.Session session, String message) throws IOException, JSONException {
        JSONObject response = new JSONObject(execute(messageRequest(session, message, scope)));
        return bounded(response.optString("status", "queued"), 32);
    }

    public void disconnect() throws IOException, JSONException {
        execute(disconnectRequest());
    }

    public boolean reportPresence(PresenceMode mode) throws IOException, JSONException {
        try {
            execute(presenceRequest(mode));
            return true;
        } catch (HttpStatusException error) {
            if (isPresenceUnsupported(error.status())) return false;
            throw error;
        }
    }

    static RequestSpec pairRequest(BridgeConfig config) throws JSONException {
        JSONObject body = new JSONObject()
                .put("code", config.pairingCode())
                .put("device_name", config.deviceName());
        return new RequestSpec("POST", "/api/pair", body.toString(), false);
    }

    static RequestSpec disconnectRequest() {
        return new RequestSpec("DELETE", "/api/device", "", true);
    }

    static RequestSpec presenceRequest(PresenceMode mode) throws JSONException {
        if (mode == null) throw new IllegalArgumentException("Presence mode is missing");
        return new RequestSpec(
                "POST",
                "/api/presence",
                new JSONObject().put("mode", mode.wireValue).toString(),
                true);
    }

    static boolean isPresenceUnsupported(int status) {
        return status == 404;
    }

    static RequestSpec eventRequest(String cursor) {
        if (!isCursor(cursor)) throw new IllegalArgumentException("Event cursor is invalid");
        return new RequestSpec("GET", "/api/events?cursor=" + cursor, "", true, 25_000);
    }

    static RequestSpec approvalRequest(Models.Action action, String decision, Models.Scope scope)
            throws JSONException {
        requireControl(scope);
        if (action == null || action.id().isBlank()) {
            throw new IllegalArgumentException("Approval is invalid");
        }
        if (!("allow_once".equals(decision) || "deny".equals(decision))) {
            throw new IllegalArgumentException("Approval decision is invalid");
        }
        boolean codex = "codex".equals(action.provider());
        JSONObject body = new JSONObject()
                .put(codex ? "approval_id" : "event_id", action.id())
                .put("decision", decision);
        return new RequestSpec(
                "POST",
                codex ? "/api/codex/approval" : "/api/hook/permission",
                body.toString(),
                true);
    }

    static RequestSpec messageRequest(Models.Session session, String rawMessage, Models.Scope scope)
            throws JSONException {
        requireControl(scope);
        String message = rawMessage == null ? "" : rawMessage.trim();
        if (session == null
                || !session.canMessage()
                || !MESSAGE_PROVIDERS.contains(session.agent())
                || session.id().isBlank()) {
            throw new IllegalArgumentException("This session cannot receive messages");
        }
        if (message.isEmpty() || message.length() > 20_000) {
            throw new IllegalArgumentException("Message must contain 1 to 20000 characters");
        }
        JSONObject body = new JSONObject()
                .put("session_id", session.id())
                .put("provider", session.agent())
                .put("message", message);
        return new RequestSpec("POST", "/api/session/message", body.toString(), true);
    }

    static Models.SessionPage parseSessions(String payload) throws JSONException {
        JSONObject root = new JSONObject(payload);
        Models.Scope scope = Models.Scope.fromWire(root.optString("scope"));
        String cursor = root.optString("cursor", "");
        if (!isCursor(cursor)) cursor = "";
        JSONArray source = root.optJSONArray("sessions");
        List<Models.Session> sessions = new ArrayList<>();
        if (source == null) {
            return new Models.SessionPage(scope, sessions, cursor);
        }
        for (int index = 0; index < Math.min(source.length(), MAX_SESSIONS); index++) {
            JSONObject item = source.optJSONObject(index);
            if (item == null) continue;
            String id = bounded(item.optString("id"), 256);
            String agent = bounded(item.optString("agent"), 64);
            if (id.isEmpty() || agent.isEmpty()) continue;
            List<Models.Action> actions = scope == Models.Scope.CONTROL
                    ? parseActions(item.optJSONArray("pending_actions"))
                    : List.of();
            sessions.add(new Models.Session(
                    id,
                    agent,
                    bounded(item.optString("project", "未命名项目"), 160),
                    bounded(item.optString("status", "idle"), 32),
                    bounded(item.optString("last_activity_at"), 64),
                    item.optBoolean("needs_attention", false),
                    scope == Models.Scope.CONTROL && item.optBoolean("can_message", false),
                    actions));
        }
        return new Models.SessionPage(scope, sessions, cursor);
    }

    static Models.EventSignal parseEventSignal(String payload) throws JSONException {
        JSONObject root = new JSONObject(payload);
        if (root.length() != 3
                || !root.has("cursor")
                || !root.has("changed")
                || !root.has("retry_after_ms")) {
            throw new JSONException("Event signal shape is invalid");
        }
        String cursor = root.getString("cursor");
        if (!isCursor(cursor) || !(root.get("changed") instanceof Boolean)) {
            throw new JSONException("Event signal value is invalid");
        }
        int retryAfter = root.getInt("retry_after_ms");
        if (retryAfter < 0 || retryAfter > 60_000) {
            throw new JSONException("Event retry is invalid");
        }
        return new Models.EventSignal(cursor, root.getBoolean("changed"));
    }

    private static List<Models.Action> parseActions(JSONArray source) {
        if (source == null) return List.of();
        List<Models.Action> actions = new ArrayList<>();
        for (int index = 0; index < Math.min(source.length(), MAX_ACTIONS); index++) {
            JSONObject item = source.optJSONObject(index);
            if (item == null) continue;
            String id = bounded(item.optString("id"), 256);
            String provider = bounded(item.optString("provider"), 64);
            if (id.isEmpty() || provider.isEmpty()) continue;
            actions.add(new Models.Action(
                    id,
                    provider,
                    bounded(item.optString("operation", "Agent action"), 80),
                    bounded(item.optString("summary", "Needs approval"), 240)));
        }
        return actions;
    }

    private String execute(RequestSpec request) throws IOException, JSONException {
        if (request.requiresToken() && token.isEmpty()) {
            throw new IllegalStateException("Pair this device first");
        }
        HttpsURLConnection connection = PinnedTlsClient.open(
                config,
                request.path(),
                request.method(),
                request.requiresToken() ? token : null,
                request.readTimeoutMillis());
        if (!request.body().isEmpty()) {
            byte[] bytes = request.body().getBytes(StandardCharsets.UTF_8);
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(bytes.length);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            try (OutputStream output = connection.getOutputStream()) {
                output.write(bytes);
            }
        }
        int status = connection.getResponseCode();
        String response = readBounded(
                status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream());
        connection.disconnect();
        if (status < 200 || status >= 300) {
            String message;
            try {
                message = new JSONObject(response).optString("error", "Request failed");
            } catch (JSONException ignored) {
                message = "Request failed";
            }
            throw new HttpStatusException(status, bounded(message, 240));
        }
        return response;
    }

    private static String readBounded(InputStream input) throws IOException {
        if (input == null) return "";
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int total = 0;
            int count;
            while ((count = stream.read(buffer)) != -1) {
                total += count;
                if (total > MAX_RESPONSE_BYTES) {
                    throw new IOException("HUMHUM response is too large");
                }
                output.write(buffer, 0, count);
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private static void requireControl(Models.Scope scope) {
        if (scope != Models.Scope.CONTROL) {
            throw new IllegalStateException("This device is paired read-only");
        }
    }

    private static String bounded(String value, int max) {
        String safe = value == null ? "" : value.trim();
        return safe.length() <= max ? safe : safe.substring(0, max);
    }

    private static boolean isCursor(String cursor) {
        return cursor != null && cursor.matches("[a-f0-9]{64}");
    }

    static final class RequestSpec {
        private final String method;
        private final String path;
        private final String body;
        private final boolean requiresToken;
        private final int readTimeoutMillis;

        RequestSpec(String method, String path, String body, boolean requiresToken) {
            this(method, path, body, requiresToken, 8_000);
        }

        RequestSpec(
                String method,
                String path,
                String body,
                boolean requiresToken,
                int readTimeoutMillis) {
            this.method = method;
            this.path = path;
            this.body = body;
            this.requiresToken = requiresToken;
            this.readTimeoutMillis = readTimeoutMillis;
        }

        String method() { return method; }
        String path() { return path; }
        String body() { return body; }
        boolean requiresToken() { return requiresToken; }
        int readTimeoutMillis() { return readTimeoutMillis; }
    }

    public static final class HttpStatusException extends IOException {
        private final int status;

        HttpStatusException(int status, String message) {
            super(message);
            this.status = status;
        }

        public int status() { return status; }
    }
}
