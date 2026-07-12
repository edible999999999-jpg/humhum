package com.humhum.mobile;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class MonitorRouteTest {
    @Test
    public void configuredRelayIsPreferredAfterPrivateSessionBaseline() {
        assertEquals(
                MonitorRoute.Next.RELAY,
                MonitorRoute.afterSessions(true, true, true, "ab".repeat(32)));
    }

    @Test
    public void unavailableRelayFallsBackToExistingDirectWatch() {
        assertEquals(
                MonitorRoute.Next.DIRECT_WATCH,
                MonitorRoute.afterSessions(false, true, true, "ab".repeat(32)));
        assertEquals(
                MonitorRoute.Next.POLL,
                MonitorRoute.afterSessions(false, false, true, "ab".repeat(32)));
        assertEquals(
                MonitorRoute.Next.POLL,
                MonitorRoute.afterSessions(false, true, true, "bad"));
    }

    @Test
    public void authenticatedWakeRefreshesWhileEmptyRelayContinuesWaiting() {
        assertEquals(MonitorRoute.Next.PRIVATE_REFRESH, MonitorRoute.afterRelay(7, 6));
        assertEquals(MonitorRoute.Next.RELAY, MonitorRoute.afterRelay(7, 7));
    }

    @Test
    public void failedPrivateRefreshReturnsToRelayWhenConfigured() {
        assertEquals(MonitorRoute.Next.RELAY, MonitorRoute.afterPrivateFailure(true));
        assertEquals(MonitorRoute.Next.POLL, MonitorRoute.afterPrivateFailure(false));
    }

    @Test
    public void stoppedOrRepairedServiceCannotCommitAnOldRelayResponse() {
        assertEquals(true, MonitorRoute.canCommitRelayResult(false, true, true));
        assertEquals(false, MonitorRoute.canCommitRelayResult(true, true, true));
        assertEquals(false, MonitorRoute.canCommitRelayResult(false, false, true));
        assertEquals(false, MonitorRoute.canCommitRelayResult(false, true, false));
    }
}
