package com.humhum.mobile;

import java.util.Map;
import java.util.Set;

public final class PushWakePolicy {
    public static final int HIGH_PRIORITY = 1;
    private static final Set<String> FIELDS = Set.of("kind", "channel", "sequence");

    public enum Decision { START_MONITOR, IGNORE }

    private PushWakePolicy() {}

    public static Decision evaluate(
            Map<String, String> data,
            int priority,
            String expectedChannel,
            boolean monitorEnabled) {
        if (!monitorEnabled
                || priority != HIGH_PRIORITY
                || data == null
                || !data.keySet().equals(FIELDS)
                || expectedChannel == null
                || !expectedChannel.matches("[a-f0-9]{64}")
                || !"humhum_wake".equals(data.get("kind"))
                || !expectedChannel.equals(data.get("channel"))) {
            return Decision.IGNORE;
        }
        String sequence = data.get("sequence");
        if (sequence == null || !sequence.matches("[1-9][0-9]{0,18}")) {
            return Decision.IGNORE;
        }
        try {
            if (Long.parseLong(sequence) <= 0) return Decision.IGNORE;
        } catch (NumberFormatException error) {
            return Decision.IGNORE;
        }
        return Decision.START_MONITOR;
    }
}
