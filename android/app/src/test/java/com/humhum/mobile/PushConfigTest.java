package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;

import org.junit.Test;

public class PushConfigTest {
    @Test
    public void absentConfigurationDisablesFcm() {
        assertNull(PushConfig.fromBuildValues("", "", "", ""));
        assertNull(PushConfig.fromBuildValues(null, null, null, null));
    }

    @Test
    public void completePublicClientConfigurationIsAccepted() {
        PushConfig config = PushConfig.fromBuildValues(
                "1:123456789012:android:abcdef0123456789",
                "AIzaSyExamplePublicClientKey1234567890",
                "humhum-mobile",
                "123456789012");

        assertEquals("1:123456789012:android:abcdef0123456789", config.applicationId());
        assertEquals("AIzaSyExamplePublicClientKey1234567890", config.apiKey());
        assertEquals("humhum-mobile", config.projectId());
        assertEquals("123456789012", config.senderId());
    }

    @Test
    public void partialOrMalformedConfigurationFailsClosed() {
        assertThrows(IllegalArgumentException.class, () -> PushConfig.fromBuildValues(
                "1:123456789012:android:abcdef0123456789", "", "humhum-mobile", "123456789012"));
        assertThrows(IllegalArgumentException.class, () -> PushConfig.fromBuildValues(
                "application", "api key with spaces", "HumHum", "sender"));
        assertThrows(IllegalArgumentException.class, () -> PushConfig.fromBuildValues(
                "1:123456:android:abcdef", "AIzaKey", "humhum-mobile", "1".repeat(513)));
    }
}
