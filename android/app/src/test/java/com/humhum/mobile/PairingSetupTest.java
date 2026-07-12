package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

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
    public void rejectsUnknownVersionsAndInvalidPairingMaterial() {
        assertThrows(IllegalArgumentException.class,
                () -> PairingSetup.parse("{\"version\":2}"));
        assertThrows(IllegalArgumentException.class,
                () -> PairingSetup.parse("{\"version\":1,\"url\":\"http://example.com\"}"));
    }
}
