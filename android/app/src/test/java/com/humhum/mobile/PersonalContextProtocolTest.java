package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.junit.Test;

public class PersonalContextProtocolTest {
    @Test
    public void personalContextUsesTheAuthenticatedBoundedRoute() {
        MobileProtocol.RequestSpec request = MobileProtocol.personalContextRequest();

        assertEquals("GET", request.method());
        assertEquals("/api/personal-context", request.path());
        assertTrue(request.requiresToken());
        assertEquals(262_144, request.maxResponseBytes());
    }

    @Test
    public void personalContextParserKeepsOnlyTheDeclaredBoundedShape() throws Exception {
        JSONObject payload = contextPayload()
                .put("today", new JSONArray().put(new JSONObject()
                        .put("id", "goal-1")
                        .put("title", "完成 Android 房间")
                        .put("detail", "通过构建与视觉检查")
                        .put("source", "hexa_goal")
                        .put("status", "active")))
                .put("preferences", new JSONArray().put(new JSONObject()
                        .put("id", "preference-1")
                        .put("category", "workflow")
                        .put("content", "先理解数据来源再设计界面")))
                .put("inbox", new JSONArray().put(new JSONObject()
                        .put("id", "message-1")
                        .put("sender", "Peidong")
                        .put("platform", "dingtalk")
                        .put("preview", "UI 已经重新推送")
                        .put("received_at", "2026-07-19T08:00:00Z")
                        .put("importance", 5)));

        Models.PersonalContext context = MobileProtocol.parsePersonalContext(payload.toString());

        assertEquals(1, context.version());
        assertEquals("完成 Android 房间", context.today().get(0).title());
        assertEquals("先理解数据来源再设计界面", context.preferences().get(0).content());
        assertEquals("Peidong", context.inbox().get(0).sender());
    }

    @Test
    public void personalContextParserRejectsUnknownAndOversizedPayloads() throws Exception {
        JSONObject unknown = contextPayload().put("raw", new JSONObject());
        assertThrows(JSONException.class,
                () -> MobileProtocol.parsePersonalContext(unknown.toString()));

        JSONArray tooManyToday = new JSONArray();
        for (int index = 0; index < 6; index++) {
            tooManyToday.put(new JSONObject()
                    .put("id", "goal-" + index)
                    .put("title", "Goal " + index)
                    .put("source", "hexa_goal")
                    .put("status", "active"));
        }
        JSONObject oversized = contextPayload().put("today", tooManyToday);
        assertThrows(JSONException.class,
                () -> MobileProtocol.parsePersonalContext(oversized.toString()));
    }

    private static JSONObject contextPayload() throws JSONException {
        return new JSONObject()
                .put("version", 1)
                .put("generated_at", "2026-07-19T09:00:00Z")
                .put("expires_at", "2026-07-20T09:00:00Z")
                .put("today", new JSONArray())
                .put("suggestions", new JSONArray())
                .put("preferences", new JSONArray())
                .put("habits", new JSONArray())
                .put("memories", new JSONArray())
                .put("knowledge", new JSONArray())
                .put("inbox", new JSONArray())
                .put("agents", new JSONArray());
    }
}
