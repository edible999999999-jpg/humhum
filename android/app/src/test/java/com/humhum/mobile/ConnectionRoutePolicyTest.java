package com.humhum.mobile;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ConnectionRoutePolicyTest {
    @Test
    public void remoteQrPairingUsesTheRelayBeforeAnUnreachableMacAddress() {
        BridgeConfig config = BridgeConfig.parse(
                "https://192.168.1.20:31276",
                "A1B2C3D4",
                "AA".repeat(32),
                "Xiaomi 14");
        Models.WakeRelayConfig relay = new Models.WakeRelayConfig(
                "https://relay.example.com",
                "11".repeat(32),
                "22".repeat(32),
                "33".repeat(32),
                "44".repeat(32),
                "55".repeat(32),
                "66".repeat(32));
        ConnectionStore.Connection remote = new ConnectionStore.Connection(
                config, "ab".repeat(32), Models.Scope.CONTROL, relay, true);
        ConnectionStore.Connection local = new ConnectionStore.Connection(
                config, "ab".repeat(32), Models.Scope.CONTROL, relay, false);

        assertTrue(ConnectionRoutePolicy.useRelayFirst(remote, true));
        assertFalse(ConnectionRoutePolicy.useRelayFirst(remote, false));
        assertFalse(ConnectionRoutePolicy.useRelayFirst(local, true));
    }
}
