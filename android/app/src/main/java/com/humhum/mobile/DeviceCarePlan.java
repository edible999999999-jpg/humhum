package com.humhum.mobile;

import java.util.List;
import java.util.Locale;

public final class DeviceCarePlan {
    public record Target(String packageName, String className) {}

    private static final List<Target> XIAOMI_AUTOSTART_TARGETS = List.of(
            new Target(
                    "com.miui.securitycenter",
                    "com.miui.permcenter.autostart.AutoStartManagementActivity"),
            new Target(
                    "com.miui.securitycenter",
                    "com.miui.powercenter.PowerSettings"),
            new Target(
                    "com.miui.securitycenter",
                    "com.miui.permcenter.permissions.AppPermissionsEditorActivity"));

    private DeviceCarePlan() {}

    public static boolean isXiaomiFamily(String manufacturer) {
        if (manufacturer == null) return false;
        String normalized = manufacturer.trim().toLowerCase(Locale.ROOT).replace(" ", "");
        return normalized.contains("xiaomi")
                || normalized.contains("redmi")
                || normalized.contains("poco")
                || normalized.contains("blackshark");
    }

    public static String batteryStatus(boolean exempt) {
        return exempt ? "系统已允许后台运行" : "系统可能限制后台运行";
    }

    public static List<Target> autostartTargets(String manufacturer) {
        return isXiaomiFamily(manufacturer) ? XIAOMI_AUTOSTART_TARGETS : List.of();
    }
}
