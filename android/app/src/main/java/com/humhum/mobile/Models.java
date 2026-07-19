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
        private final boolean personalContext;

        public PairResult(String token, Scope scope) {
            this(token, scope, null, false);
        }

        public PairResult(String token, Scope scope, WakeRelayConfig wakeRelay) {
            this(token, scope, wakeRelay, false);
        }

        public PairResult(
                String token,
                Scope scope,
                WakeRelayConfig wakeRelay,
                boolean personalContext) {
            this.token = token;
            this.scope = scope;
            this.wakeRelay = wakeRelay;
            this.personalContext = personalContext;
        }

        public String token() { return token; }
        public Scope scope() { return scope; }
        public WakeRelayConfig wakeRelay() { return wakeRelay; }
        public boolean personalContext() { return personalContext; }
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

    public static final class SignalUploadResult {
        private final int imported;
        private final int duplicates;

        public SignalUploadResult(int imported, int duplicates) {
            if (imported < 0 || duplicates < 0 || imported + duplicates > 31) {
                throw new IllegalArgumentException("Signal upload result is invalid");
            }
            this.imported = imported;
            this.duplicates = duplicates;
        }

        public int imported() { return imported; }
        public int duplicates() { return duplicates; }
    }

    public static final class TodayItem {
        private final String id;
        private final String title;
        private final String detail;
        private final String source;
        private final String status;

        public TodayItem(String id, String title, String detail, String source, String status) {
            this.id = id;
            this.title = title;
            this.detail = detail;
            this.source = source;
            this.status = status;
        }

        public String id() { return id; }
        public String title() { return title; }
        public String detail() { return detail; }
        public String source() { return source; }
        public String status() { return status; }
    }

    public static final class Suggestion {
        private final String id;
        private final String title;
        private final String rationale;
        private final String source;
        private final String confidence;

        public Suggestion(
                String id, String title, String rationale, String source, String confidence) {
            this.id = id;
            this.title = title;
            this.rationale = rationale;
            this.source = source;
            this.confidence = confidence;
        }

        public String id() { return id; }
        public String title() { return title; }
        public String rationale() { return rationale; }
        public String source() { return source; }
        public String confidence() { return confidence; }
    }

    public static final class Preference {
        private final String id;
        private final String category;
        private final String content;

        public Preference(String id, String category, String content) {
            this.id = id;
            this.category = category;
            this.content = content;
        }

        public String id() { return id; }
        public String category() { return category; }
        public String content() { return content; }
    }

    public static final class Habit {
        private final String id;
        private final String title;
        private final String cadence;
        private final String status;

        public Habit(String id, String title, String cadence, String status) {
            this.id = id;
            this.title = title;
            this.cadence = cadence;
            this.status = status;
        }

        public String id() { return id; }
        public String title() { return title; }
        public String cadence() { return cadence; }
        public String status() { return status; }
    }

    public static final class Memory {
        private final String id;
        private final String content;
        private final String temperature;

        public Memory(String id, String content, String temperature) {
            this.id = id;
            this.content = content;
            this.temperature = temperature;
        }

        public String id() { return id; }
        public String content() { return content; }
        public String temperature() { return temperature; }
    }

    public static final class KnowledgeItem {
        private final String id;
        private final String title;
        private final String summary;
        private final String kind;

        public KnowledgeItem(String id, String title, String summary, String kind) {
            this.id = id;
            this.title = title;
            this.summary = summary;
            this.kind = kind;
        }

        public String id() { return id; }
        public String title() { return title; }
        public String summary() { return summary; }
        public String kind() { return kind; }
    }

    public static final class InboxItem {
        private final String id;
        private final String sender;
        private final String platform;
        private final String preview;
        private final String receivedAt;
        private final int importance;

        public InboxItem(
                String id,
                String sender,
                String platform,
                String preview,
                String receivedAt,
                int importance) {
            this.id = id;
            this.sender = sender;
            this.platform = platform;
            this.preview = preview;
            this.receivedAt = receivedAt;
            this.importance = importance;
        }

        public String id() { return id; }
        public String sender() { return sender; }
        public String platform() { return platform; }
        public String preview() { return preview; }
        public String receivedAt() { return receivedAt; }
        public int importance() { return importance; }
    }

    public static final class AgentItem {
        private final String id;
        private final String name;
        private final String provider;
        private final String status;
        private final String currentStep;
        private final boolean needsUser;
        private final String updatedAt;

        public AgentItem(
                String id,
                String name,
                String provider,
                String status,
                String currentStep,
                boolean needsUser,
                String updatedAt) {
            this.id = id;
            this.name = name;
            this.provider = provider;
            this.status = status;
            this.currentStep = currentStep;
            this.needsUser = needsUser;
            this.updatedAt = updatedAt;
        }

        public String id() { return id; }
        public String name() { return name; }
        public String provider() { return provider; }
        public String status() { return status; }
        public String currentStep() { return currentStep; }
        public boolean needsUser() { return needsUser; }
        public String updatedAt() { return updatedAt; }
    }

    public static final class PersonalContext {
        private final int version;
        private final String generatedAt;
        private final String expiresAt;
        private final List<TodayItem> today;
        private final List<Suggestion> suggestions;
        private final List<Preference> preferences;
        private final List<Habit> habits;
        private final List<Memory> memories;
        private final List<KnowledgeItem> knowledge;
        private final List<InboxItem> inbox;
        private final List<AgentItem> agents;

        public PersonalContext(
                int version,
                String generatedAt,
                String expiresAt,
                List<TodayItem> today,
                List<Suggestion> suggestions,
                List<Preference> preferences,
                List<Habit> habits,
                List<Memory> memories,
                List<KnowledgeItem> knowledge,
                List<InboxItem> inbox,
                List<AgentItem> agents) {
            this.version = version;
            this.generatedAt = generatedAt;
            this.expiresAt = expiresAt;
            this.today = List.copyOf(today);
            this.suggestions = List.copyOf(suggestions);
            this.preferences = List.copyOf(preferences);
            this.habits = List.copyOf(habits);
            this.memories = List.copyOf(memories);
            this.knowledge = List.copyOf(knowledge);
            this.inbox = List.copyOf(inbox);
            this.agents = List.copyOf(agents);
        }

        public int version() { return version; }
        public String generatedAt() { return generatedAt; }
        public String expiresAt() { return expiresAt; }
        public List<TodayItem> today() { return today; }
        public List<Suggestion> suggestions() { return suggestions; }
        public List<Preference> preferences() { return preferences; }
        public List<Habit> habits() { return habits; }
        public List<Memory> memories() { return memories; }
        public List<KnowledgeItem> knowledge() { return knowledge; }
        public List<InboxItem> inbox() { return inbox; }
        public List<AgentItem> agents() { return agents; }
    }
}
