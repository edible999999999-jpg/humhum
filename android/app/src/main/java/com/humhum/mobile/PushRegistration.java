package com.humhum.mobile;

import android.content.Context;
import com.google.firebase.messaging.FirebaseMessaging;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class PushRegistration {
    private static final ExecutorService NETWORK = Executors.newSingleThreadExecutor();
    public enum Decision { REGISTER, SKIP }

    private PushRegistration() {}

    public static Decision plan(
            boolean configured,
            boolean paired,
            boolean relayConfigured,
            String token) {
        return configured
                && paired
                && relayConfigured
                && token != null
                && token.matches("[\\x21-\\x7e]{1,4096}")
                ? Decision.REGISTER
                : Decision.SKIP;
    }

    public static void refresh(Context context) {
        if (!HumHumApplication.isFcmConfigured()) return;
        Context application = context.getApplicationContext();
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (task.isSuccessful()) registerToken(application, task.getResult());
        });
    }

    public static void registerToken(Context context, String token) {
        Context application = context.getApplicationContext();
        ConnectionStore.Connection connection = connectionStore(application).load();
        boolean relayConfigured = connection != null && connection.wakeRelay() != null;
        if (plan(
                HumHumApplication.isFcmConfigured(),
                connection != null,
                relayConfigured,
                token) != Decision.REGISTER) return;
        String channel = connection.wakeRelay().channelId();
        NETWORK.execute(() -> {
            ConnectionStore.Connection current = connectionStore(application).load();
            String currentChannel = current == null || current.wakeRelay() == null
                    ? null
                    : current.wakeRelay().channelId();
            if (!sameChannel(channel, currentChannel)) return;
            try {
                new WakeRelayClient().putPushToken(current.wakeRelay(), token);
            } catch (Exception ignored) {
                // Foreground relay polling remains available and a later token refresh retries.
            }
        });
    }

    static boolean sameChannel(String expected, String current) {
        return expected != null && expected.matches("[a-f0-9]{64}") && expected.equals(current);
    }

    private static ConnectionStore connectionStore(Context context) {
        return new ConnectionStore(
                context.getSharedPreferences("humhum_connection", Context.MODE_PRIVATE));
    }
}
