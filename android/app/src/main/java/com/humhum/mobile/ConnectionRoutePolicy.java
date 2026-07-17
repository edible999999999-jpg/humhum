package com.humhum.mobile;

public final class ConnectionRoutePolicy {
    private ConnectionRoutePolicy() {}

    public static boolean useRelayFirst(
            ConnectionStore.Connection connection, boolean relayGatewayAvailable) {
        return relayGatewayAvailable
                && connection != null
                && connection.prefersRelay()
                && connection.wakeRelay() != null
                && connection.wakeRelay().version() == 2;
    }
}
