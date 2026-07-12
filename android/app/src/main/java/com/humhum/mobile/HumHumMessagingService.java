package com.humhum.mobile;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public final class HumHumMessagingService extends FirebaseMessagingService {
    @Override public void onNewToken(String token) {
        PushRegistration.registerToken(this, token);
    }

    @Override public void onMessageReceived(RemoteMessage message) {
        ConnectionStore.Connection connection = new ConnectionStore(
                getSharedPreferences("humhum_connection", MODE_PRIVATE)).load();
        Models.WakeRelayConfig relay = connection == null ? null : connection.wakeRelay();
        MonitorStore monitor = AgentMonitorService.monitorStore(this);
        String expectedChannel = relay == null ? null : relay.channelId();
        if (PushWakePolicy.evaluate(
                message.getData(),
                message.getPriority(),
                expectedChannel,
                monitor.isEnabled()) != PushWakePolicy.Decision.START_MONITOR) return;
        boolean notificationsAllowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                        == PackageManager.PERMISSION_GRANTED;
        if (!notificationsAllowed) return;
        try {
            AgentMonitorService.startFromPush(this);
        } catch (RuntimeException ignored) {
            // A downgraded or OEM-blocked background start waits for the next visible launch.
        }
    }
}
