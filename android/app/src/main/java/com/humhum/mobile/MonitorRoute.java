package com.humhum.mobile;

final class MonitorRoute {
    enum Next {
        RELAY,
        DIRECT_WATCH,
        PRIVATE_REFRESH,
        POLL
    }

    private MonitorRoute() {}

    static Next afterSessions(
            boolean relayAvailable,
            boolean realtimeSupported,
            boolean monitorEnabled,
            String cursor) {
        if (!monitorEnabled) return Next.POLL;
        if (relayAvailable) return Next.RELAY;
        return realtimeSupported && cursor != null && cursor.matches("[a-f0-9]{64}")
                ? Next.DIRECT_WATCH
                : Next.POLL;
    }

    static Next afterRelay(long acceptedSequence, long previousSequence) {
        return acceptedSequence > previousSequence ? Next.PRIVATE_REFRESH : Next.RELAY;
    }

    static Next afterPrivateFailure(boolean relayAvailable) {
        return relayAvailable ? Next.RELAY : Next.POLL;
    }

    static boolean canCommitRelayResult(
            boolean destroyed,
            boolean monitorEnabled,
            boolean sameChannel) {
        return !destroyed && monitorEnabled && sameChannel;
    }
}
