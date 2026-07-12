package com.humhum.mobile;

import static org.junit.Assert.assertEquals;

import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.Test;

public class PushWakePolicyTest {
    private static final String CHANNEL = "11".repeat(32);

    @Test
    public void exactHighPriorityWakeStartsAnEnabledMonitor() {
        assertEquals(PushWakePolicy.Decision.START_MONITOR, PushWakePolicy.evaluate(
                wake(CHANNEL, "7"), PushWakePolicy.HIGH_PRIORITY, CHANNEL, true));
    }

    @Test
    public void priorityChannelAndOptInAllFailClosed() {
        assertEquals(PushWakePolicy.Decision.IGNORE, PushWakePolicy.evaluate(
                wake(CHANNEL, "7"), 0, CHANNEL, true));
        assertEquals(PushWakePolicy.Decision.IGNORE, PushWakePolicy.evaluate(
                wake("22".repeat(32), "7"), PushWakePolicy.HIGH_PRIORITY, CHANNEL, true));
        assertEquals(PushWakePolicy.Decision.IGNORE, PushWakePolicy.evaluate(
                wake(CHANNEL, "7"), PushWakePolicy.HIGH_PRIORITY, CHANNEL, false));
        assertEquals(PushWakePolicy.Decision.IGNORE, PushWakePolicy.evaluate(
                wake(CHANNEL, "7"), PushWakePolicy.HIGH_PRIORITY, null, true));
    }

    @Test
    public void payloadShapeAndSequenceAreStrict() {
        for (String sequence : new String[] {"0", "-1", "+1", "01", "9223372036854775808", "x"}) {
            assertEquals(PushWakePolicy.Decision.IGNORE, PushWakePolicy.evaluate(
                    wake(CHANNEL, sequence), PushWakePolicy.HIGH_PRIORITY, CHANNEL, true));
        }
        Map<String, String> extra = new LinkedHashMap<>(wake(CHANNEL, "1"));
        extra.put("message", "private");
        assertEquals(PushWakePolicy.Decision.IGNORE, PushWakePolicy.evaluate(
                extra, PushWakePolicy.HIGH_PRIORITY, CHANNEL, true));
        assertEquals(PushWakePolicy.Decision.IGNORE, PushWakePolicy.evaluate(
                Map.of("kind", "other", "channel", CHANNEL, "sequence", "1"),
                PushWakePolicy.HIGH_PRIORITY,
                CHANNEL,
                true));
    }

    private static Map<String, String> wake(String channel, String sequence) {
        return Map.of(
                "kind", "humhum_wake",
                "channel", channel,
                "sequence", sequence);
    }
}
