package com.humhum.mobile;

public final class MonitorPermissionPolicy {
    private static final int ANDROID_13 = 33;

    private MonitorPermissionPolicy() {}

    public static boolean needsRequest(int sdk, boolean granted) {
        return sdk >= ANDROID_13 && !granted;
    }

    public static boolean canStart(int sdk, boolean granted) {
        return !needsRequest(sdk, granted);
    }
}
