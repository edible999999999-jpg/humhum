package com.humhum.mobile;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class PushRetryPolicyTest {
    @Test
    public void delaysGrowAndRemainCapped() {
        assertEquals(15, PushRetryPolicy.delaySeconds(0));
        assertEquals(60, PushRetryPolicy.delaySeconds(1));
        assertEquals(300, PushRetryPolicy.delaySeconds(2));
        assertEquals(300, PushRetryPolicy.delaySeconds(20));
    }

    @Test
    public void statusesSeparateRetryPairingAndTerminalFailures() {
        assertEquals(PushRetryPolicy.Outcome.RETRY, PushRetryPolicy.forStatus(429));
        assertEquals(PushRetryPolicy.Outcome.RETRY, PushRetryPolicy.forStatus(500));
        assertEquals(PushRetryPolicy.Outcome.RETRY, PushRetryPolicy.forStatus(599));
        assertEquals(PushRetryPolicy.Outcome.NEEDS_PAIRING, PushRetryPolicy.forStatus(401));
        assertEquals(PushRetryPolicy.Outcome.NEEDS_PAIRING, PushRetryPolicy.forStatus(404));
        assertEquals(PushRetryPolicy.Outcome.NEEDS_PAIRING, PushRetryPolicy.forStatus(410));
        assertEquals(PushRetryPolicy.Outcome.STOP, PushRetryPolicy.forStatus(400));
        assertEquals(PushRetryPolicy.Outcome.STOP, PushRetryPolicy.forStatus(302));
    }
}
