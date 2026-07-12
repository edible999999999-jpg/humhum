package com.humhum.mobile;

public final class PushRetryPolicy {
    private static final long[] DELAYS = {15, 60, 300};

    public enum Outcome { RETRY, NEEDS_PAIRING, STOP }

    private PushRetryPolicy() {}

    public static long delaySeconds(int failureIndex) {
        int safe = Math.max(0, Math.min(failureIndex, DELAYS.length - 1));
        return DELAYS[safe];
    }

    public static Outcome forStatus(int status) {
        if (status == 401 || status == 404 || status == 410) return Outcome.NEEDS_PAIRING;
        if (status == 429 || (status >= 500 && status <= 599)) return Outcome.RETRY;
        return Outcome.STOP;
    }
}
