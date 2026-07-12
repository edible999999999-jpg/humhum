package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.List;
import org.junit.Test;

public class DeviceCarePlanTest {
    @Test
    public void recognizesXiaomiFamilyManufacturersCaseInsensitively() {
        assertTrue(DeviceCarePlan.isXiaomiFamily("Xiaomi"));
        assertTrue(DeviceCarePlan.isXiaomiFamily("redmi"));
        assertTrue(DeviceCarePlan.isXiaomiFamily("POCO"));
        assertTrue(DeviceCarePlan.isXiaomiFamily("BlackShark"));
        assertFalse(DeviceCarePlan.isXiaomiFamily("Google"));
        assertFalse(DeviceCarePlan.isXiaomiFamily(null));
    }

    @Test
    public void reportsOnlyTheObservableBatteryState() {
        assertEquals("系统已允许后台运行", DeviceCarePlan.batteryStatus(true));
        assertEquals("系统可能限制后台运行", DeviceCarePlan.batteryStatus(false));
    }

    @Test
    public void xiaomiTargetsAreOrderedAndAllowListed() {
        List<DeviceCarePlan.Target> targets = DeviceCarePlan.autostartTargets("Xiaomi");

        assertEquals(3, targets.size());
        assertEquals("com.miui.securitycenter", targets.get(0).packageName());
        assertEquals(
                "com.miui.permcenter.autostart.AutoStartManagementActivity",
                targets.get(0).className());
        assertEquals("com.miui.securitycenter", targets.get(1).packageName());
        assertEquals(
                "com.miui.powercenter.PowerSettings",
                targets.get(1).className());
        assertEquals("com.miui.securitycenter", targets.get(2).packageName());
        assertEquals(
                "com.miui.permcenter.permissions.AppPermissionsEditorActivity",
                targets.get(2).className());
    }

    @Test
    public void genericDevicesHaveNoVendorAutostartTargets() {
        assertTrue(DeviceCarePlan.autostartTargets("Google").isEmpty());
    }
}
