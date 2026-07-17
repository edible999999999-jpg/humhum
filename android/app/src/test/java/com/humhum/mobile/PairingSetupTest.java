package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class PairingSetupTest {
    @Test
    public void parsesTheDesktopAndroidSetupBundle() throws Exception {
        PairingSetup setup = PairingSetup.parse(
                "{\"version\":1,\"url\":\"https://192.168.1.20:31276\","
                        + "\"code\":\"ABCD1234\",\"scope\":\"control\","
                        + "\"fingerprint\":\"AA" + "BB".repeat(31) + "\"}");

        assertEquals("https://192.168.1.20:31276", setup.url());
        assertEquals("ABCD1234", setup.code());
        assertEquals("AA" + "BB".repeat(31), setup.fingerprint());
        assertEquals(Models.Scope.CONTROL, setup.scope());
    }

    @Test
    public void parsesTemporaryAnywherePairingWithoutExposingPermanentCredentials() {
        PairingSetup setup = PairingSetup.parse(
                "{\"version\":2,\"url\":\"https://30.169.112.223:31276\","
                        + "\"code\":\"568FD1A4\",\"scope\":\"control\","
                        + "\"fingerprint\":\"" + "AA".repeat(32) + "\","
                        + "\"expires_at\":1800000300,"
                        + "\"pairing_relay\":{\"version\":2,"
                        + "\"base_url\":\"https://relay.example.com\","
                        + "\"channel_id\":\"" + "11".repeat(32) + "\","
                        + "\"subscriber_token\":\"" + "22".repeat(32) + "\","
                        + "\"wake_key\":\"" + "33".repeat(32) + "\","
                        + "\"command\":{\"channel_id\":\"" + "44".repeat(32) + "\","
                        + "\"publisher_token\":\"" + "55".repeat(32) + "\","
                        + "\"key\":\"" + "66".repeat(32) + "\"}}}");

        assertTrue(setup.canPairRemotely());
        assertEquals(1_800_000_300L, setup.expiresAt());
        assertEquals("https://relay.example.com", setup.pairingRelay().baseUrl());
        assertEquals("44".repeat(32), setup.pairingRelay().commandChannelId());
        assertFalse(setup.rawSource().contains("\"token\""));
    }

    @Test
    public void rejectsUnknownVersionsAndInvalidPairingMaterial() {
        assertThrows(IllegalArgumentException.class,
                () -> PairingSetup.parse("{\"version\":3}"));
        assertThrows(IllegalArgumentException.class,
                () -> PairingSetup.parse("{\"version\":1,\"url\":\"http://example.com\"}"));
    }
}
