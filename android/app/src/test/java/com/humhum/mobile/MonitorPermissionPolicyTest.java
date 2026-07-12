package com.humhum.mobile;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class MonitorPermissionPolicyTest {
    @Test
    public void androidThirteenAndNewerRequestNotificationsBeforeStarting() {
        assertTrue(MonitorPermissionPolicy.needsRequest(33, false));
        assertTrue(MonitorPermissionPolicy.needsRequest(36, false));
        assertFalse(MonitorPermissionPolicy.canStart(36, false));
    }

    @Test
    public void olderOrGrantedDevicesCanStartDirectly() {
        assertFalse(MonitorPermissionPolicy.needsRequest(32, false));
        assertTrue(MonitorPermissionPolicy.canStart(32, false));
        assertFalse(MonitorPermissionPolicy.needsRequest(36, true));
        assertTrue(MonitorPermissionPolicy.canStart(36, true));
    }
}
