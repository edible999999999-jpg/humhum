package com.humhum.mobile;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

public final class MonitorBootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        MonitorStore monitorStore = AgentMonitorService.monitorStore(context);
        ConnectionStore connectionStore = new ConnectionStore(
                context.getSharedPreferences("humhum_connection", Context.MODE_PRIVATE));
        boolean notificationsGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                        == PackageManager.PERMISSION_GRANTED;
        if (monitorStore.isEnabled()
                && connectionStore.load() != null
                && MonitorPermissionPolicy.canStart(Build.VERSION.SDK_INT, notificationsGranted)) {
            AgentMonitorService.start(context);
        }
    }
}
