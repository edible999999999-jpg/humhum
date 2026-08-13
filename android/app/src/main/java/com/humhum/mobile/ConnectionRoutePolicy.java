package com.humhum.mobile;

public final class ConnectionRoutePolicy {
    private ConnectionRoutePolicy() {}

    public static boolean useRelayFirst(
            ConnectionStore.Connection connection, boolean relayGatewayAvailable) {
        return useRelayFirst(connection, relayGatewayAvailable, false);
    }

    public static boolean useRelayFirst(
            ConnectionStore.Connection connection,
            boolean relayGatewayAvailable,
            boolean lastSuccessfulRouteWasRelay) {
        return relayGatewayAvailable
                && connection != null
                && connection.wakeRelay() != null
                && connection.wakeRelay().version() == 2
                && (connection.prefersRelay() || lastSuccessfulRouteWasRelay);
    }
}
