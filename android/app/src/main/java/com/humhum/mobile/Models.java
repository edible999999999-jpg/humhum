package com.humhum.mobile;

import java.util.List;
import java.util.Locale;

public final class Models {
    private Models() {}

    public enum Scope {
        READ,
        CONTROL;

        public static Scope fromWire(String value) {
            return "control".equalsIgnoreCase(value) ? CONTROL : READ;
        }

        public String wireValue() {
            return name().toLowerCase(Locale.ROOT);
        }
    }

    public static final class PairResult {
        private final String token;
        private final Scope scope;
        private final WakeRelayConfig wakeRelay;

        public PairResult(String token, Scope scope) {
            this(token, scope, null);
        }

        public PairResult(String token, Scope scope, WakeRelayConfig wakeRelay) {
            this.token = token;
            this.scope = scope;
            this.wakeRelay = wakeRelay;
        }

        public String token() { return token; }
        public Scope scope() { return scope; }
        public WakeRelayConfig wakeRelay() { return wakeRelay; }
    }

    public static final class WakeRelayConfig {
        private final String baseUrl;
        private final String channelId;
        private final String subscriberToken;
        private final String wakeKey;
        private final String commandChannelId;
        private final String commandPublisherToken;
        private final String commandKey;

        public WakeRelayConfig(
                String baseUrl,
                String channelId,
                String subscriberToken,
                String wakeKey) {
            this(baseUrl, channelId, subscriberToken, wakeKey, null, null, null);
        }

        public WakeRelayConfig(
                String baseUrl,
                String channelId,
                String subscriberToken,
                String wakeKey,
                String commandChannelId,
                String commandPublisherToken,
                String commandKey) {
            this.baseUrl = WakeRelayClient.validateBaseUrl(baseUrl);
            this.channelId = requireSecret(channelId, "Relay channel is invalid");
            this.subscriberToken = requireSecret(
                    subscriberToken, "Relay subscriber credential is invalid");
            this.wakeKey = requireSecret(wakeKey, "Relay wake key is invalid");
            boolean hasAnyCommand = commandChannelId != null
                    || commandPublisherToken != null
                    || commandKey != null;
            if (hasAnyCommand) {
                this.commandChannelId = requireSecret(
                        commandChannelId, "Anywhere command channel is invalid");
                this.commandPublisherToken = requireSecret(
                        commandPublisherToken, "Anywhere publisher credential is invalid");
                this.commandKey = requireSecret(commandKey, "Anywhere command key is invalid");
                if (this.commandChannelId.equals(this.channelId)
                        || this.commandKey.equals(this.wakeKey)) {
                    throw new IllegalArgumentException("Anywhere channel roles are not independent");
                }
            } else {
                this.commandChannelId = null;
                this.commandPublisherToken = null;
                this.commandKey = null;
            }
        }

        public String baseUrl() { return baseUrl; }
        public String channelId() { return channelId; }
        public String subscriberToken() { return subscriberToken; }
        public String wakeKey() { return wakeKey; }
        public int version() { return commandChannelId == null ? 1 : 2; }
        public String commandChannelId() { return commandChannelId; }
        public String commandPublisherToken() { return commandPublisherToken; }
        public String commandKey() { return commandKey; }

        private static String requireSecret(String value, String message) {
            String safe = value == null ? "" : value.trim();
            if (!safe.matches("[a-f0-9]{64}")) throw new IllegalArgumentException(message);
            return safe;
        }
    }

    public static final class Action {
        private final String id;
        private final String provider;
        private final String operation;
        private final String summary;

        public Action(String id, String provider, String operation, String summary) {
            this.id = id;
            this.provider = provider;
            this.operation = operation;
            this.summary = summary;
        }

        public String id() { return id; }
        public String provider() { return provider; }
        public String operation() { return operation; }
        public String summary() { return summary; }
    }

    public enum ConversationRole {
        USER,
        ASSISTANT;

        public static ConversationRole fromWire(String value) {
            if ("user".equals(value)) return USER;
            if ("assistant".equals(value)) return ASSISTANT;
            throw new IllegalArgumentException("Conversation role is invalid");
        }

        public String wireValue() {
            return name().toLowerCase(Locale.ROOT);
        }
    }

    public static final class ConversationMessage {
        private final ConversationRole role;
        private final String text;

        public ConversationMessage(ConversationRole role, String text) {
            if (role == null) throw new IllegalArgumentException("Conversation role is missing");
            this.role = role;
            this.text = text == null ? "" : text;
        }

        public ConversationRole role() { return role; }
        public String text() { return text; }
    }

    public static final class Session {
        private final String id;
        private final String agent;
        private final String project;
        private final String status;
        private final String lastActivityAt;
        private final boolean needsAttention;
        private final boolean canMessage;
        private final boolean canReadConversation;
        private final List<Action> actions;

        public Session(
                String id,
                String agent,
                String project,
                String status,
                String lastActivityAt,
                boolean needsAttention,
                boolean canMessage,
                List<Action> actions) {
            this(
                    id,
                    agent,
                    project,
                    status,
                    lastActivityAt,
                    needsAttention,
                    canMessage,
                    false,
                    actions);
        }

        public Session(
                String id,
                String agent,
                String project,
                String status,
                String lastActivityAt,
                boolean needsAttention,
                boolean canMessage,
                boolean canReadConversation,
                List<Action> actions) {
            this.id = id;
            this.agent = agent;
            this.project = project;
            this.status = status;
            this.lastActivityAt = lastActivityAt;
            this.needsAttention = needsAttention;
            this.canMessage = canMessage;
            this.canReadConversation = canReadConversation;
            this.actions = List.copyOf(actions);
        }

        public String id() { return id; }
        public String agent() { return agent; }
        public String project() { return project; }
        public String status() { return status; }
        public String lastActivityAt() { return lastActivityAt; }
        public boolean needsAttention() { return needsAttention; }
        public boolean canMessage() { return canMessage; }
        public boolean canReadConversation() { return canReadConversation; }
        public List<Action> actions() { return actions; }
    }

    public static final class SessionPage {
        private final Scope scope;
        private final List<Session> sessions;
        private final String cursor;

        public SessionPage(Scope scope, List<Session> sessions) {
            this(scope, sessions, "");
        }

        public SessionPage(Scope scope, List<Session> sessions, String cursor) {
            this.scope = scope;
            this.sessions = List.copyOf(sessions);
            this.cursor = cursor == null ? "" : cursor;
        }

        public Scope scope() { return scope; }
        public List<Session> sessions() { return sessions; }
        public String cursor() { return cursor; }
    }

    public static final class EventSignal {
        private final String cursor;
        private final boolean changed;

        public EventSignal(String cursor, boolean changed) {
            this.cursor = cursor;
            this.changed = changed;
        }

        public String cursor() { return cursor; }
        public boolean changed() { return changed; }
    }
}
