package com.humhum.mobile;

import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public final class PersonalContextCodec {
    private static final int MAX_PAYLOAD_BYTES = 256 * 1024;

    private PersonalContextCodec() {}

    public static byte[] encode(Models.PersonalContext context) {
        if (context == null) throw new IllegalArgumentException("Personal context is missing");
        try {
            JSONArray today = new JSONArray();
            for (Models.TodayItem item : context.today()) {
                today.put(new JSONObject()
                        .put("id", item.id())
                        .put("title", item.title())
                        .put("detail", item.detail() == null ? JSONObject.NULL : item.detail())
                        .put("source", item.source())
                        .put("status", item.status()));
            }
            JSONArray suggestions = new JSONArray();
            for (Models.Suggestion item : context.suggestions()) {
                suggestions.put(new JSONObject()
                        .put("id", item.id())
                        .put("title", item.title())
                        .put("rationale", item.rationale())
                        .put("source", item.source())
                        .put("confidence", item.confidence()));
            }
            JSONArray preferences = new JSONArray();
            for (Models.Preference item : context.preferences()) {
                preferences.put(new JSONObject()
                        .put("id", item.id())
                        .put("category", item.category())
                        .put("content", item.content()));
            }
            JSONArray habits = new JSONArray();
            for (Models.Habit item : context.habits()) {
                habits.put(new JSONObject()
                        .put("id", item.id())
                        .put("title", item.title())
                        .put("cadence", item.cadence())
                        .put("status", item.status()));
            }
            JSONArray memories = new JSONArray();
            for (Models.Memory item : context.memories()) {
                memories.put(new JSONObject()
                        .put("id", item.id())
                        .put("content", item.content())
                        .put("temperature", item.temperature()));
            }
            JSONArray knowledge = new JSONArray();
            for (Models.KnowledgeItem item : context.knowledge()) {
                knowledge.put(new JSONObject()
                        .put("id", item.id())
                        .put("title", item.title())
                        .put("summary", item.summary())
                        .put("kind", item.kind()));
            }
            JSONArray inbox = new JSONArray();
            for (Models.InboxItem item : context.inbox()) {
                inbox.put(new JSONObject()
                        .put("id", item.id())
                        .put("sender", item.sender())
                        .put("platform", item.platform())
                        .put("preview", item.preview())
                        .put("received_at", item.receivedAt())
                        .put("importance", item.importance()));
            }
            JSONArray agents = new JSONArray();
            for (Models.AgentItem item : context.agents()) {
                agents.put(new JSONObject()
                        .put("id", item.id())
                        .put("name", item.name())
                        .put("provider", item.provider())
                        .put("status", item.status())
                        .put(
                                "current_step",
                                item.currentStep() == null ? JSONObject.NULL : item.currentStep())
                        .put("needs_user", item.needsUser())
                        .put("updated_at", item.updatedAt()));
            }
            byte[] payload = new JSONObject()
                    .put("version", context.version())
                    .put("generated_at", context.generatedAt())
                    .put("expires_at", context.expiresAt())
                    .put("today", today)
                    .put("suggestions", suggestions)
                    .put("preferences", preferences)
                    .put("habits", habits)
                    .put("memories", memories)
                    .put("knowledge", knowledge)
                    .put("inbox", inbox)
                    .put("agents", agents)
                    .toString()
                    .getBytes(StandardCharsets.UTF_8);
            if (payload.length > MAX_PAYLOAD_BYTES) {
                throw new IllegalArgumentException("Personal context payload is too large");
            }
            return payload;
        } catch (JSONException error) {
            throw new IllegalArgumentException("Personal context payload is invalid", error);
        }
    }

    public static Models.PersonalContext decode(byte[] payload) {
        if (payload == null || payload.length == 0 || payload.length > MAX_PAYLOAD_BYTES) {
            throw new IllegalArgumentException("Personal context payload is invalid");
        }
        try {
            Models.PersonalContext context =
                    MobileProtocol.parsePersonalContext(new String(payload, StandardCharsets.UTF_8));
            byte[] canonical = encode(context);
            if (!java.util.Arrays.equals(payload, canonical)) {
                throw new IllegalArgumentException("Personal context payload is not canonical");
            }
            return context;
        } catch (JSONException error) {
            throw new IllegalArgumentException("Personal context payload is invalid", error);
        }
    }
}
