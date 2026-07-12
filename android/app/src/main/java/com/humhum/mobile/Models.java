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

        public WakeRelayConfig(
                String baseUrl,
                String channelId,
                String subscriberToken,
                String wakeKey) {
            this.baseUrl = WakeRelayClient.validateBaseUrl(baseUrl);
            this.channelId = requireSecret(channelId, "Relay channel is invalid");
            this.subscriberToken = requireSecret(
                    subscriberToken, "Relay subscriber credential is invalid");
            this.wakeKey = requireSecret(wakeKey, "Relay wake key is invalid");
        }

        public String baseUrl() { return baseUrl; }
        public String channelId() { return channelId; }
        public String subscriberToken() { return subscriberToken; }
        public String wakeKey() { return wakeKey; }

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

    public static final class Session {
        private final String id;
        private final String agent;
        private final String project;
        private final String status;
        private final String lastActivityAt;
        private final boolean needsAttention;
        private final boolean canMessage;
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
            this.id = id;
            this.agent = agent;
            this.project = project;
            this.status = status;
            this.lastActivityAt = lastActivityAt;
            this.needsAttention = needsAttention;
            this.canMessage = canMessage;
            this.actions = List.copyOf(actions);
        }

        public String id() { return id; }
        public String agent() { return agent; }
        public String project() { return project; }
        public String status() { return status; }
        public String lastActivityAt() { return lastActivityAt; }
        public boolean needsAttention() { return needsAttention; }
        public boolean canMessage() { return canMessage; }
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
