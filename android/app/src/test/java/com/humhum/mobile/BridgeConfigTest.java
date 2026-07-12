package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class BridgeConfigTest {
    private static final String FINGERPRINT =
            "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:"
                    + "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99";

    @Test
    public void acceptsPrivateIpv4BridgeAndNormalizesInputs() {
        BridgeConfig config = BridgeConfig.parse(
                "https://192.168.1.20:31276/",
                "ab12cd34",
                FINGERPRINT,
                "  Xiaomi 14  ");

        assertEquals("https://192.168.1.20:31276", config.baseUrl());
        assertEquals("AB12CD34", config.pairingCode());
        assertEquals(FINGERPRINT.replace(":", ""), config.fingerprint());
        assertEquals("Xiaomi 14", config.deviceName());
    }

    @Test
    public void acceptsLocalHostnameAndDefaultDeviceName() {
        BridgeConfig config = BridgeConfig.parse(
                "https://humhum.local:31276", "A1B2C3D4", FINGERPRINT, "  ");

        assertEquals("https://humhum.local:31276", config.baseUrl());
        assertEquals("Xiaomi Android", config.deviceName());
    }

    @Test
    public void identifiesBoundedTailnetRoutes() {
        BridgeConfig first = BridgeConfig.parse(
                "https://100.64.0.1:31276", "A1B2C3D4", FINGERPRINT, "Phone");
        BridgeConfig last = BridgeConfig.parse(
                "https://100.127.255.254:31276", "A1B2C3D4", FINGERPRINT, "Phone");
        BridgeConfig lan = BridgeConfig.parse(
                "https://192.168.1.20:31276", "A1B2C3D4", FINGERPRINT, "Phone");

        assertTrue(first.isTailnet());
        assertTrue(last.isTailnet());
        assertFalse(lan.isTailnet());
    }

    @Test
    public void rejectsTailnetBoundariesAndReservedServiceAddresses() {
        for (String address : new String[] {
                "100.64.0.0", "100.127.255.255", "100.100.0.1", "100.100.100.100"
        }) {
            assertThrows(IllegalArgumentException.class, () -> BridgeConfig.parse(
                    "https://" + address + ":31276",
                    "A1B2C3D4",
                    FINGERPRINT,
                    "Phone"));
        }
    }

    @Test
    public void pinnedTlsHostMustMatchTheSelectedPrivateRoute() {
        BridgeConfig config = BridgeConfig.parse(
                "https://100.101.2.3:31276", "A1B2C3D4", FINGERPRINT, "Phone");

        assertTrue(PinnedTlsClient.hostMatchesConfig("100.101.2.3", config));
        assertFalse(PinnedTlsClient.hostMatchesConfig("192.168.1.20", config));
        assertFalse(PinnedTlsClient.hostMatchesConfig("example.com", config));
    }

    @Test
    public void rejectsInsecureOrPublicDestinations() {
        assertThrows(IllegalArgumentException.class, () -> BridgeConfig.parse(
                "http://192.168.1.20:31276", "A1B2C3D4", FINGERPRINT, "Phone"));
        assertThrows(IllegalArgumentException.class, () -> BridgeConfig.parse(
                "https://example.com:31276", "A1B2C3D4", FINGERPRINT, "Phone"));
        assertThrows(IllegalArgumentException.class, () -> BridgeConfig.parse(
                "https://8.8.8.8:31276", "A1B2C3D4", FINGERPRINT, "Phone"));
    }

    @Test
    public void rejectsWrongPortAndUrlSmuggling() {
        assertThrows(IllegalArgumentException.class, () -> BridgeConfig.parse(
                "https://192.168.1.20:443", "A1B2C3D4", FINGERPRINT, "Phone"));
        assertThrows(IllegalArgumentException.class, () -> BridgeConfig.parse(
                "https://user@192.168.1.20:31276", "A1B2C3D4", FINGERPRINT, "Phone"));
        assertThrows(IllegalArgumentException.class, () -> BridgeConfig.parse(
                "https://192.168.1.20:31276?next=evil", "A1B2C3D4", FINGERPRINT, "Phone"));
    }

    @Test
    public void rejectsMalformedPairingMaterial() {
        assertThrows(IllegalArgumentException.class, () -> BridgeConfig.parse(
                "https://192.168.1.20:31276", "SHORT", FINGERPRINT, "Phone"));
        assertThrows(IllegalArgumentException.class, () -> BridgeConfig.parse(
                "https://192.168.1.20:31276", "A1B2C3D4", "1234", "Phone"));
        assertThrows(IllegalArgumentException.class, () -> BridgeConfig.parse(
                "https://192.168.1.20:31276", "A1B2C3D4", FINGERPRINT.replace("AA", "GG"), "Phone"));
    }
}
