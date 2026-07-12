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

        public PairResult(String token, Scope scope) {
            this.token = token;
            this.scope = scope;
        }

        public String token() { return token; }
        public Scope scope() { return scope; }
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

        public SessionPage(Scope scope, List<Session> sessions) {
            this.scope = scope;
            this.sessions = List.copyOf(sessions);
        }

        public Scope scope() { return scope; }
        public List<Session> sessions() { return sessions; }
    }
}
