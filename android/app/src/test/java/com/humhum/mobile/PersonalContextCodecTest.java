package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class PersonalContextCodecTest {
    @Test
    public void contextRoundTripsThroughCanonicalCachePayload() throws Exception {
        Models.PersonalContext source = MobileProtocol.parsePersonalContext(new JSONObject()
                .put("version", 1)
                .put("generated_at", "2026-07-19T09:00:00Z")
                .put("expires_at", "2026-07-20T09:00:00Z")
                .put("today", new JSONArray())
                .put("suggestions", new JSONArray())
                .put("preferences", new JSONArray())
                .put("habits", new JSONArray())
                .put("memories", new JSONArray())
                .put("knowledge", new JSONArray().put(new JSONObject()
                        .put("id", "skill-1")
                        .put("title", "数据整理")
                        .put("summary", "把信息变成可复用结构")
                        .put("kind", "skill")))
                .put("inbox", new JSONArray())
                .put("agents", new JSONArray())
                .toString());

        byte[] encoded = PersonalContextCodec.encode(source);
        Models.PersonalContext decoded = PersonalContextCodec.decode(encoded);

        assertEquals("数据整理", decoded.knowledge().get(0).title());
        assertEquals(new String(encoded, java.nio.charset.StandardCharsets.UTF_8),
                new String(PersonalContextCodec.encode(decoded),
                        java.nio.charset.StandardCharsets.UTF_8));
    }

    @Test
    public void cacheFreshnessExpiresAtExactlyTwentyFourHours() {
        long savedAt = 1_800_000_000_000L;

        assertTrue(PersonalContextSnapshot.isFresh(savedAt, savedAt + 86_399_999L));
        assertFalse(PersonalContextSnapshot.isFresh(savedAt, savedAt + 86_400_000L));
        assertFalse(PersonalContextSnapshot.isFresh(savedAt, savedAt - 1L));
    }
}
