package com.humhum.mobile;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;

public final class DeviceCareNavigator {
    private DeviceCareNavigator() {}

    public static boolean openBatterySettings(Activity activity) {
        if (launch(activity, new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS), false)) {
            return true;
        }
        return openAppDetails(activity);
    }

    public static boolean openAutostartSettings(Activity activity, String manufacturer) {
        for (DeviceCarePlan.Target target : DeviceCarePlan.autostartTargets(manufacturer)) {
            Intent intent = new Intent()
                    .setComponent(new ComponentName(target.packageName(), target.className()))
                    .putExtra("extra_pkgname", activity.getPackageName())
                    .putExtra("package_name", activity.getPackageName());
            if (launch(activity, intent, true)) return true;
        }
        return openAppDetails(activity);
    }

    private static boolean openAppDetails(Activity activity) {
        Intent intent = new Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + activity.getPackageName()));
        return launch(activity, intent, false);
    }

    private static boolean launch(Activity activity, Intent intent, boolean requireResolution) {
        if (requireResolution
                && activity.getPackageManager().resolveActivity(
                        intent, PackageManager.MATCH_DEFAULT_ONLY) == null) {
            return false;
        }
        try {
            activity.startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException error) {
            return false;
        }
    }
}
