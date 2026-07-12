package com.humhum.mobile;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class PushRegistrationTest {
    @Test
    public void registrationRequiresConfigurationPairingRelayAndBoundedToken() {
        assertEquals(PushRegistration.Decision.REGISTER, PushRegistration.plan(
                true, true, true, "fcm:opaque-token"));
        assertEquals(PushRegistration.Decision.SKIP, PushRegistration.plan(
                false, true, true, "fcm:opaque-token"));
        assertEquals(PushRegistration.Decision.SKIP, PushRegistration.plan(
                true, false, true, "fcm:opaque-token"));
        assertEquals(PushRegistration.Decision.SKIP, PushRegistration.plan(
                true, true, false, "fcm:opaque-token"));
        assertEquals(PushRegistration.Decision.SKIP, PushRegistration.plan(
                true, true, true, ""));
        assertEquals(PushRegistration.Decision.SKIP, PushRegistration.plan(
                true, true, true, "A".repeat(4_097)));
        assertEquals(PushRegistration.Decision.SKIP, PushRegistration.plan(
                true, true, true, "token with spaces"));
    }

    @Test
    public void lateRegistrationIsRejectedAfterDisconnectOrChannelChange() {
        String channel = "11".repeat(32);
        assertEquals(true, PushRegistration.sameChannel(channel, channel));
        assertEquals(false, PushRegistration.sameChannel(channel, null));
        assertEquals(false, PushRegistration.sameChannel(channel, "22".repeat(32)));
    }
}
