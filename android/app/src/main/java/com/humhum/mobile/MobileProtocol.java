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
    private static final int MAX_CONVERSATION_RESPONSE_BYTES = 65_536;
    private static final int MAX_SESSIONS = 30;
    private static final int MAX_ACTIONS = 20;
    private static final int MAX_CONVERSATION_MESSAGES = 12;
    private static final int MAX_CONVERSATION_TEXT_SCALARS = 500;
    private static final int MAX_PERSONAL_CONTEXT_BYTES = 256 * 1024;
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
        return parsePairResult(execute(pairRequest(config)));
    }

    static Models.PairResult parsePairResult(String payload) throws IOException, JSONException {
        JSONObject response = new JSONObject(payload);
        String pairedToken = response.optString("token", "");
        if (!pairedToken.matches("[a-fA-F0-9]{64}")) {
            throw new IOException("HUMHUM returned an invalid device token");
        }
        Models.WakeRelayConfig wakeRelay = null;
        if (response.has("wake_relay")) {
            wakeRelay = parseWakeRelay(response.getJSONObject("wake_relay"));
        }
        Object personalContextValue = response.opt("personal_context");
        if (personalContextValue != null && !(personalContextValue instanceof Boolean)) {
            throw new JSONException("Personal context capability is invalid");
        }
        return new Models.PairResult(
                pairedToken,
                Models.Scope.fromWire(response.optString("scope")),
                wakeRelay,
                personalContextValue instanceof Boolean && (Boolean) personalContextValue);
    }

    static Models.WakeRelayConfig parseWakeRelay(JSONObject relay) throws JSONException {
        int version = strictInteger(relay, "version");
        if ((version == 1 && relay.length() != 5)
                || (version == 2 && relay.length() != 6)
                || (version != 1 && version != 2)
                || !relay.has("base_url")
                || !relay.has("channel_id")
                || !relay.has("subscriber_token")
                || !relay.has("wake_key")) {
            throw new JSONException("Wake relay pairing data is invalid");
        }
        try {
            if (version == 1) {
                return new Models.WakeRelayConfig(
                        relay.getString("base_url"),
                        relay.getString("channel_id"),
                        relay.getString("subscriber_token"),
                        relay.getString("wake_key"));
            }
            JSONObject command = relay.getJSONObject("command");
            if (command.length() != 3
                    || !command.has("channel_id")
                    || !command.has("publisher_token")
                    || !command.has("key")) {
                throw new JSONException("Anywhere command pairing data is invalid");
            }
            return new Models.WakeRelayConfig(
                    relay.getString("base_url"),
                    relay.getString("channel_id"),
                    relay.getString("subscriber_token"),
                    relay.getString("wake_key"),
                    command.getString("channel_id"),
                    command.getString("publisher_token"),
                    command.getString("key"));
        } catch (IllegalArgumentException error) {
            JSONException invalid = new JSONException("Wake relay pairing data is invalid");
            invalid.initCause(error);
            throw invalid;
        }
    }

    private static int strictInteger(JSONObject object, String key) throws JSONException {
        Object value = object.get(key);
        if (!(value instanceof Integer)) {
            throw new JSONException("Numeric field is invalid");
        }
        return (Integer) value;
    }

    private static String strictString(JSONObject object, String key) throws JSONException {
        Object value = object.get(key);
        if (!(value instanceof String)) {
            throw new JSONException("String field is invalid");
        }
        return (String) value;
    }

    public Models.SessionPage sessions() throws IOException, JSONException {
        return parseSessions(execute(new RequestSpec("GET", "/api/sessions", "", true)));
    }

    public Models.PersonalContext personalContext() throws IOException, JSONException {
        return parsePersonalContext(execute(personalContextRequest()));
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

    public List<Models.ConversationMessage> conversation(Models.Session session)
            throws IOException, JSONException {
        return parseConversation(execute(conversationRequest(session)), session.id());
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

    public Models.SignalUploadResult uploadSignals(JSONArray signals)
            throws IOException, JSONException {
        return parseSignalUploadResponse(execute(signalUploadRequest(signals)));
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

    static RequestSpec personalContextRequest() {
        return new RequestSpec(
                "GET",
                "/api/personal-context",
                "",
                true,
                8_000,
                MAX_PERSONAL_CONTEXT_BYTES);
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

    static RequestSpec signalUploadRequest(JSONArray signals) throws JSONException {
        if (signals == null || signals.length() > 31) {
            throw new IllegalArgumentException("Health signal batch must contain at most 31 records");
        }
        return new RequestSpec(
                "POST",
                "/api/hush/signals",
                new JSONObject().put("signals", signals).toString(),
                true);
    }

    static Models.SignalUploadResult parseSignalUploadResponse(String payload)
            throws JSONException {
        JSONObject response = new JSONObject(payload);
        if (response.length() != 2
                || !response.has("imported")
                || !response.has("duplicates")) {
            throw new JSONException("Health signal acknowledgement shape is invalid");
        }
        int imported = strictInteger(response, "imported");
        int duplicates = strictInteger(response, "duplicates");
        try {
            return new Models.SignalUploadResult(imported, duplicates);
        } catch (IllegalArgumentException error) {
            JSONException invalid =
                    new JSONException("Health signal acknowledgement is invalid");
            invalid.initCause(error);
            throw invalid;
        }
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

    static RequestSpec conversationRequest(Models.Session session) throws JSONException {
        if (session == null || session.id().isBlank() || !session.canReadConversation()) {
            throw new IllegalArgumentException("Recent conversation is unavailable");
        }
        return new RequestSpec(
                "POST",
                "/api/session/conversation",
                new JSONObject().put("session_id", session.id()).toString(),
                true,
                8_000,
                MAX_CONVERSATION_RESPONSE_BYTES);
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
                    strictBoolean(item, "needs_attention"),
                    scope == Models.Scope.CONTROL && strictBoolean(item, "can_message"),
                    strictBoolean(item, "can_read_conversation"),
                    actions));
        }
        return new Models.SessionPage(scope, sessions, cursor);
    }

    static Models.PersonalContext parsePersonalContext(String payload) throws JSONException {
        if (payload == null
                || payload.getBytes(StandardCharsets.UTF_8).length > MAX_PERSONAL_CONTEXT_BYTES) {
            throw new JSONException("Personal context response is too large");
        }
        JSONObject root = new JSONObject(payload);
        requireExactKeys(root, Set.of(
                "version",
                "generated_at",
                "expires_at",
                "today",
                "suggestions",
                "preferences",
                "habits",
                "memories",
                "knowledge",
                "inbox",
                "agents"));
        if (strictInteger(root, "version") != 1) {
            throw new JSONException("Personal context version is invalid");
        }
        return new Models.PersonalContext(
                1,
                boundedStrict(root, "generated_at", 64),
                boundedStrict(root, "expires_at", 64),
                parseToday(strictArray(root, "today"), 5),
                parseSuggestions(strictArray(root, "suggestions"), 3),
                parsePreferences(strictArray(root, "preferences"), 8),
                parseHabits(strictArray(root, "habits"), 8),
                parseMemories(strictArray(root, "memories"), 6),
                parseKnowledge(strictArray(root, "knowledge"), 8),
                parseInbox(strictArray(root, "inbox"), 8),
                parseAgents(strictArray(root, "agents"), 8));
    }

    private static List<Models.TodayItem> parseToday(JSONArray array, int maximum)
            throws JSONException {
        requireBoundedArray(array, maximum);
        List<Models.TodayItem> output = new ArrayList<>();
        for (int index = 0; index < array.length(); index++) {
            JSONObject item = strictObject(array, index);
            requireKeys(item, Set.of("id", "title", "source", "status"), Set.of("detail"));
            output.add(new Models.TodayItem(
                    boundedStrict(item, "id", 160),
                    boundedStrict(item, "title", 180),
                    optionalBounded(item, "detail", 220),
                    boundedStrict(item, "source", 40),
                    boundedStrict(item, "status", 24)));
        }
        return output;
    }

    private static List<Models.Suggestion> parseSuggestions(JSONArray array, int maximum)
            throws JSONException {
        requireBoundedArray(array, maximum);
        List<Models.Suggestion> output = new ArrayList<>();
        for (int index = 0; index < array.length(); index++) {
            JSONObject item = strictObject(array, index);
            requireExactKeys(item, Set.of(
                    "id", "title", "rationale", "source", "confidence"));
            output.add(new Models.Suggestion(
                    boundedStrict(item, "id", 160),
                    boundedStrict(item, "title", 180),
                    boundedStrict(item, "rationale", 240),
                    boundedStrict(item, "source", 40),
                    boundedStrict(item, "confidence", 24)));
        }
        return output;
    }

    private static List<Models.Preference> parsePreferences(JSONArray array, int maximum)
            throws JSONException {
        requireBoundedArray(array, maximum);
        List<Models.Preference> output = new ArrayList<>();
        for (int index = 0; index < array.length(); index++) {
            JSONObject item = strictObject(array, index);
            requireExactKeys(item, Set.of("id", "category", "content"));
            output.add(new Models.Preference(
                    boundedStrict(item, "id", 160),
                    boundedStrict(item, "category", 60),
                    boundedStrict(item, "content", 240)));
        }
        return output;
    }

    private static List<Models.Habit> parseHabits(JSONArray array, int maximum)
            throws JSONException {
        requireBoundedArray(array, maximum);
        List<Models.Habit> output = new ArrayList<>();
        for (int index = 0; index < array.length(); index++) {
            JSONObject item = strictObject(array, index);
            requireExactKeys(item, Set.of("id", "title", "cadence", "status"));
            output.add(new Models.Habit(
                    boundedStrict(item, "id", 160),
                    boundedStrict(item, "title", 180),
                    boundedStrict(item, "cadence", 80),
                    boundedStrict(item, "status", 24)));
        }
        return output;
    }

    private static List<Models.Memory> parseMemories(JSONArray array, int maximum)
            throws JSONException {
        requireBoundedArray(array, maximum);
        List<Models.Memory> output = new ArrayList<>();
        for (int index = 0; index < array.length(); index++) {
            JSONObject item = strictObject(array, index);
            requireExactKeys(item, Set.of("id", "content", "temperature"));
            output.add(new Models.Memory(
                    boundedStrict(item, "id", 160),
                    boundedStrict(item, "content", 260),
                    boundedStrict(item, "temperature", 24)));
        }
        return output;
    }

    private static List<Models.KnowledgeItem> parseKnowledge(JSONArray array, int maximum)
            throws JSONException {
        requireBoundedArray(array, maximum);
        List<Models.KnowledgeItem> output = new ArrayList<>();
        for (int index = 0; index < array.length(); index++) {
            JSONObject item = strictObject(array, index);
            requireExactKeys(item, Set.of("id", "title", "summary", "kind"));
            output.add(new Models.KnowledgeItem(
                    boundedStrict(item, "id", 160),
                    boundedStrict(item, "title", 180),
                    boundedStrict(item, "summary", 260),
                    boundedStrict(item, "kind", 24)));
        }
        return output;
    }

    private static List<Models.InboxItem> parseInbox(JSONArray array, int maximum)
            throws JSONException {
        requireBoundedArray(array, maximum);
        List<Models.InboxItem> output = new ArrayList<>();
        for (int index = 0; index < array.length(); index++) {
            JSONObject item = strictObject(array, index);
            requireExactKeys(item, Set.of(
                    "id", "sender", "platform", "preview", "received_at", "importance"));
            int importance = strictInteger(item, "importance");
            if (importance < 0 || importance > 5) {
                throw new JSONException("Personal context importance is invalid");
            }
            output.add(new Models.InboxItem(
                    boundedStrict(item, "id", 160),
                    boundedStrict(item, "sender", 100),
                    boundedStrict(item, "platform", 40),
                    boundedStrict(item, "preview", 240),
                    boundedStrict(item, "received_at", 64),
                    importance));
        }
        return output;
    }

    private static List<Models.AgentItem> parseAgents(JSONArray array, int maximum)
            throws JSONException {
        requireBoundedArray(array, maximum);
        List<Models.AgentItem> output = new ArrayList<>();
        for (int index = 0; index < array.length(); index++) {
            JSONObject item = strictObject(array, index);
            requireKeys(
                    item,
                    Set.of("id", "name", "provider", "status", "needs_user", "updated_at"),
                    Set.of("current_step"));
            Object needsUser = item.get("needs_user");
            if (!(needsUser instanceof Boolean)) {
                throw new JSONException("Personal context Agent status is invalid");
            }
            output.add(new Models.AgentItem(
                    boundedStrict(item, "id", 160),
                    boundedStrict(item, "name", 160),
                    boundedStrict(item, "provider", 40),
                    boundedStrict(item, "status", 24),
                    optionalBounded(item, "current_step", 240),
                    (Boolean) needsUser,
                    boundedStrict(item, "updated_at", 64)));
        }
        return output;
    }

    private static JSONArray strictArray(JSONObject object, String key) throws JSONException {
        Object value = object.get(key);
        if (!(value instanceof JSONArray)) {
            throw new JSONException("Personal context collection is invalid");
        }
        return (JSONArray) value;
    }

    private static JSONObject strictObject(JSONArray array, int index) throws JSONException {
        Object value = array.get(index);
        if (!(value instanceof JSONObject)) {
            throw new JSONException("Personal context item is invalid");
        }
        return (JSONObject) value;
    }

    private static void requireBoundedArray(JSONArray array, int maximum) throws JSONException {
        if (array.length() > maximum) {
            throw new JSONException("Personal context collection is too large");
        }
    }

    private static void requireExactKeys(JSONObject object, Set<String> keys)
            throws JSONException {
        requireKeys(object, keys, Set.of());
    }

    private static void requireKeys(
            JSONObject object, Set<String> required, Set<String> optional) throws JSONException {
        for (String key : required) {
            if (!object.has(key)) {
                throw new JSONException("Personal context item is missing fields");
            }
        }
        java.util.Iterator<String> keys = object.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if (!required.contains(key) && !optional.contains(key)) {
                throw new JSONException("Personal context item has unknown fields");
            }
        }
    }

    private static String boundedStrict(JSONObject object, String key, int maximum)
            throws JSONException {
        String value = strictString(object, key);
        int scalars = value.codePointCount(0, value.length());
        if (value.isBlank() || scalars > maximum) {
            throw new JSONException("Personal context text is invalid");
        }
        return value;
    }

    private static String optionalBounded(JSONObject object, String key, int maximum)
            throws JSONException {
        if (!object.has(key) || object.isNull(key)) return null;
        return boundedStrict(object, key, maximum);
    }

    static List<Models.ConversationMessage> parseConversation(
            String payload, String expectedSessionId) throws JSONException {
        if (expectedSessionId == null || expectedSessionId.isBlank()) {
            throw new IllegalArgumentException("Session is invalid");
        }
        if (payload == null
                || payload.getBytes(StandardCharsets.UTF_8).length > MAX_CONVERSATION_RESPONSE_BYTES) {
            throw new JSONException("Conversation response is too large");
        }
        JSONObject root = new JSONObject(payload);
        if (root.length() != 2 || !root.has("session_id") || !root.has("messages")) {
            throw new JSONException("Conversation shape is invalid");
        }
        String sessionId = strictString(root, "session_id");
        if (!expectedSessionId.equals(sessionId)) {
            throw new JSONException("Conversation session is invalid");
        }
        Object messagesValue = root.get("messages");
        if (!(messagesValue instanceof JSONArray)) {
            throw new JSONException("Conversation messages are invalid");
        }
        JSONArray source = (JSONArray) messagesValue;
        if (source.length() > MAX_CONVERSATION_MESSAGES) {
            throw new JSONException("Conversation messages are invalid");
        }
        List<Models.ConversationMessage> messages = new ArrayList<>();
        for (int index = 0; index < source.length(); index++) {
            Object value = source.get(index);
            if (!(value instanceof JSONObject)) {
                throw new JSONException("Conversation message is invalid");
            }
            JSONObject item = (JSONObject) value;
            if (item.length() != 2 || !item.has("role") || !item.has("text")) {
                throw new JSONException("Conversation message is invalid");
            }
            String role = strictString(item, "role");
            String text = strictString(item, "text");
            if (text.isBlank() || text.codePointCount(0, text.length()) > MAX_CONVERSATION_TEXT_SCALARS) {
                throw new JSONException("Conversation text is invalid");
            }
            try {
                messages.add(new Models.ConversationMessage(
                        Models.ConversationRole.fromWire(role),
                        text));
            } catch (IllegalArgumentException error) {
                JSONException invalid = new JSONException("Conversation role is invalid");
                invalid.initCause(error);
                throw invalid;
            }
        }
        return messages;
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

    private static boolean strictBoolean(JSONObject object, String key) {
        Object value = object.opt(key);
        return value instanceof Boolean && (Boolean) value;
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
        try {
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
                    status >= 200 && status < 300
                            ? connection.getInputStream()
                            : connection.getErrorStream(),
                    request.maxResponseBytes());
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
        } finally {
            connection.disconnect();
        }
    }

    static String readBounded(InputStream input, int maxBytes) throws IOException {
        if (input == null) return "";
        if (maxBytes < 1 || maxBytes > MAX_RESPONSE_BYTES) {
            throw new IllegalArgumentException("Response limit is invalid");
        }
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int total = 0;
            int count;
            while ((count = stream.read(buffer)) != -1) {
                total += count;
                if (total > maxBytes) {
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
        private final int maxResponseBytes;

        RequestSpec(String method, String path, String body, boolean requiresToken) {
            this(method, path, body, requiresToken, 8_000, MAX_RESPONSE_BYTES);
        }

        RequestSpec(
                String method,
                String path,
                String body,
                boolean requiresToken,
                int readTimeoutMillis) {
            this(method, path, body, requiresToken, readTimeoutMillis, MAX_RESPONSE_BYTES);
        }

        RequestSpec(
                String method,
                String path,
                String body,
                boolean requiresToken,
                int readTimeoutMillis,
                int maxResponseBytes) {
            this.method = method;
            this.path = path;
            this.body = body;
            this.requiresToken = requiresToken;
            this.readTimeoutMillis = readTimeoutMillis;
            this.maxResponseBytes = maxResponseBytes;
        }

        String method() { return method; }
        String path() { return path; }
        String body() { return body; }
        boolean requiresToken() { return requiresToken; }
        int readTimeoutMillis() { return readTimeoutMillis; }
        int maxResponseBytes() { return maxResponseBytes; }
    }

    public static final class HttpStatusException extends IOException {
        private final int status;

        public HttpStatusException(int status, String message) {
            super(message);
            this.status = status;
        }

        public int status() { return status; }
    }
}
