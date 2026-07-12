package com.humhum.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Build;
import android.os.IBinder;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

public final class AgentMonitorService extends Service {
    private static final String MONITOR_CHANNEL = "humhum_monitor";
    private static final String ATTENTION_CHANNEL = "humhum_attention";
    private static final int MONITOR_NOTIFICATION = 4101;
    private static final int ATTENTION_NOTIFICATION = 4102;
    private static final long[] RETRY_SECONDS = {15, 30, 60};

    private final ScheduledExecutorService network = Executors.newSingleThreadScheduledExecutor();
    private final NetworkRecoveryGate recoveryGate = new NetworkRecoveryGate();
    private final WakeRelayClient relayClient = new WakeRelayClient();
    private final ServiceLifecycleGate lifecycle = new ServiceLifecycleGate();
    private ScheduledFuture<?> nextPoll;
    private MonitorStore monitorStore;
    private AttentionTracker tracker;
    private int failures;
    private volatile boolean destroyed;
    private boolean realtimeSupported = true;
    private boolean presenceSupported = true;
    private boolean relaySupported = true;
    private String lastCursor = "";
    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;
    private boolean networkCallbackRegistered;

    public static void start(Context context) {
        Intent intent = new Intent(context, AgentMonitorService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    public static void stop(Context context) {
        context.stopService(new Intent(context, AgentMonitorService.class));
    }

    public static MonitorStore monitorStore(Context context) {
        return new MonitorStore(context.getSharedPreferences("humhum_monitor", MODE_PRIVATE));
    }

    private static ConnectionStore connectionStore(Context context) {
        return new ConnectionStore(context.getSharedPreferences("humhum_connection", MODE_PRIVATE));
    }

    @Override public void onCreate() {
        super.onCreate();
        monitorStore = monitorStore(this);
        tracker = new AttentionTracker(monitorStore.knownDigests());
        createChannels();
        promote(notification(getString(R.string.monitor_notification_text)));
        registerNetworkRecovery();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        schedulePoll(0);
        return START_STICKY;
    }

    @Override public IBinder onBind(Intent intent) {
        return null;
    }

    @Override public void onDestroy() {
        lifecycle.close(() -> {
            destroyed = true;
            relayClient.cancel();
            unregisterNetworkRecovery();
            if (nextPoll != null) nextPoll.cancel(true);
            network.shutdownNow();
        });
        super.onDestroy();
    }

    private void schedulePoll(long delaySeconds) {
        schedule(this::pollOnce, delaySeconds);
    }

    private void scheduleWatch(String cursor) {
        schedule(() -> watchOnce(cursor), 0);
    }

    private void scheduleRelay(long sequence) {
        schedule(() -> relayOnce(sequence), 0);
    }

    private void schedule(Runnable task, long delaySeconds) {
        lifecycle.commit(() -> {
            if (nextPoll != null) nextPoll.cancel(false);
            nextPoll = network.schedule(task, delaySeconds, TimeUnit.SECONDS);
        });
    }

    private void pollOnce() {
        ConnectionStore.Connection connection = connectionStore(this).load();
        if (!monitorStore.isEnabled() || connection == null) {
            lifecycle.commit(() -> {
                monitorStore.clear();
                stopSelf();
            });
            return;
        }
        try {
            MobileProtocol protocol = new MobileProtocol(
                    connection.config(), connection.token(), connection.scope());
            Models.SessionPage page = protocol.sessions();
            AttentionTracker.Result result = tracker.evaluate(page);
            reportMonitoringPresence(protocol);
            lifecycle.commit(() -> {
                monitorStore.saveKnownDigests(result.knownDigests());
                failures = 0;
                updateOngoing(getString(R.string.monitor_notification_text));
                if (result.newCount() > 0) notifyAttention(result.newCount());
                lastCursor = page.cursor();
                switch (MonitorRoute.afterSessions(
                        relaySupported && connection.wakeRelay() != null,
                        realtimeSupported,
                        monitorStore.isEnabled(),
                        lastCursor)) {
                    case RELAY -> scheduleRelay(monitorStore.relaySequence(
                            connection.wakeRelay().channelId()));
                    case DIRECT_WATCH -> scheduleWatch(lastCursor);
                    default -> schedulePoll(RETRY_SECONDS[0]);
                }
            });
        } catch (MobileProtocol.HttpStatusException error) {
            if (destroyed) return;
            if (error.status() == 401 || error.status() == 403) {
                lifecycle.commit(() -> {
                    monitorStore.clear();
                    stopSelf();
                });
            } else {
                retryAfterPrivateFailure(connection);
            }
        } catch (Exception error) {
            if (destroyed) return;
            retryAfterPrivateFailure(connection);
        }
    }

    private void relayOnce(long previousSequence) {
        ConnectionStore.Connection connection = connectionStore(this).load();
        if (!monitorStore.isEnabled() || connection == null) {
            lifecycle.commit(() -> {
                monitorStore.clear();
                stopSelf();
            });
            return;
        }
        Models.WakeRelayConfig relay = connection.wakeRelay();
        if (!relaySupported || relay == null) {
            scheduleDirectFallback();
            return;
        }
        try {
            long accepted = relayClient.poll(
                    relay,
                    previousSequence,
                    System.currentTimeMillis() / 1_000L);
            ConnectionStore.Connection current = connectionStore(this).load();
            boolean sameChannel = current != null
                    && current.wakeRelay() != null
                    && relay.channelId().equals(current.wakeRelay().channelId());
            if (!MonitorRoute.canCommitRelayResult(
                    destroyed, monitorStore.isEnabled(), sameChannel)) {
                return;
            }
            lifecycle.commit(() -> {
                if (!MonitorRoute.canCommitRelayResult(
                        destroyed, monitorStore.isEnabled(), sameChannel)) return;
                failures = 0;
                updateOngoing(getString(R.string.monitor_notification_text));
                if (MonitorRoute.afterRelay(accepted, previousSequence)
                        == MonitorRoute.Next.PRIVATE_REFRESH) {
                    monitorStore.saveRelaySequence(relay.channelId(), accepted);
                    schedulePoll(0);
                } else {
                    scheduleRelay(accepted);
                }
            });
        } catch (WakeRelayClient.RelayStatusException error) {
            if (destroyed) return;
            if (WakeRelayClient.isPermanentlyUnavailable(error.status())) {
                lifecycle.commit(() -> {
                    relaySupported = false;
                    failures = 0;
                    updateOngoing(getString(R.string.monitor_notification_text));
                    scheduleDirectFallback();
                });
            } else {
                retryAfterRelayFailure();
            }
        } catch (java.security.GeneralSecurityException | org.json.JSONException error) {
            if (destroyed) return;
            lifecycle.commit(() -> {
                relaySupported = false;
                failures = 0;
                scheduleDirectFallback();
            });
        } catch (Exception error) {
            if (destroyed) return;
            retryAfterRelayFailure();
        }
    }

    private void scheduleDirectFallback() {
        lifecycle.commit(() -> {
            if (realtimeSupported && lastCursor.matches("[a-f0-9]{64}")) {
                scheduleWatch(lastCursor);
            } else {
                schedulePoll(RETRY_SECONDS[0]);
            }
        });
    }

    private void watchOnce(String cursor) {
        ConnectionStore.Connection connection = connectionStore(this).load();
        if (!monitorStore.isEnabled() || connection == null) {
            lifecycle.commit(() -> {
                monitorStore.clear();
                stopSelf();
            });
            return;
        }
        try {
            MobileProtocol protocol = new MobileProtocol(
                    connection.config(), connection.token(), connection.scope());
            Models.EventSignal signal = protocol.waitForChange(cursor);
            reportMonitoringPresence(protocol);
            lifecycle.commit(() -> {
                failures = 0;
                if (signal.changed() || !cursor.equals(signal.cursor())) {
                    schedulePoll(0);
                } else {
                    scheduleWatch(signal.cursor());
                }
            });
        } catch (MobileProtocol.HttpStatusException error) {
            if (destroyed) return;
            if (error.status() == 401 || error.status() == 403) {
                lifecycle.commit(() -> {
                    monitorStore.clear();
                    stopSelf();
                });
            } else if (error.status() == 404) {
                lifecycle.commit(() -> {
                    realtimeSupported = false;
                    failures = 0;
                    updateOngoing(getString(R.string.monitor_notification_text));
                    schedulePoll(RETRY_SECONDS[0]);
                });
            } else {
                retryAfterPrivateFailure(connection);
            }
        } catch (Exception error) {
            if (destroyed) return;
            retryAfterPrivateFailure(connection);
        }
    }

    private void reportMonitoringPresence(MobileProtocol protocol) throws Exception {
        Exception[] failure = {null};
        lifecycle.commit(() -> {
            try {
                if (presenceSupported
                        && !protocol.reportPresence(MobileProtocol.PresenceMode.MONITORING)) {
                    presenceSupported = false;
                }
            } catch (Exception error) {
                failure[0] = error;
            }
        });
        if (failure[0] != null) {
            throw failure[0];
        }
    }

    private long nextRetryDelay() {
        updateOngoing(getString(R.string.monitor_notification_unreachable));
        long delay = RETRY_SECONDS[Math.min(failures, RETRY_SECONDS.length - 1)];
        failures++;
        return delay;
    }

    private void retryAfterPrivateFailure(ConnectionStore.Connection connection) {
        lifecycle.commit(() -> {
            long delay = nextRetryDelay();
            if (MonitorRoute.afterPrivateFailure(
                    relaySupported && connection.wakeRelay() != null) == MonitorRoute.Next.RELAY) {
                Models.WakeRelayConfig relay = connection.wakeRelay();
                schedule(() -> relayOnce(monitorStore.relaySequence(relay.channelId())), delay);
            } else {
                schedulePoll(delay);
            }
        });
    }

    private void retryAfterRelayFailure() {
        lifecycle.commit(() -> schedulePoll(nextRetryDelay()));
    }

    private void registerNetworkRecovery() {
        connectivityManager = getSystemService(ConnectivityManager.class);
        if (connectivityManager == null) return;
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network availableNetwork) {
                if (destroyed || !recoveryGate.onNetworkAvailable()) return;
                try {
                    network.execute(() -> {
                        lifecycle.commit(() -> {
                            failures = 0;
                            schedulePoll(0);
                        });
                    });
                } catch (RejectedExecutionException ignored) {
                    // Service shutdown won the race with this connectivity callback.
                }
            }

            @Override public void onLost(Network lostNetwork) {
                recoveryGate.onNetworkLost();
            }
        };
        try {
            connectivityManager.registerDefaultNetworkCallback(networkCallback);
            networkCallbackRegistered = true;
        } catch (RuntimeException ignored) {
            networkCallback = null;
        }
    }

    private void unregisterNetworkRecovery() {
        if (!networkCallbackRegistered || connectivityManager == null || networkCallback == null) return;
        networkCallbackRegistered = false;
        try {
            connectivityManager.unregisterNetworkCallback(networkCallback);
        } catch (RuntimeException ignored) {
            // The bounded poll retry remains active until service shutdown completes.
        }
    }

    private void promote(Notification notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                    MONITOR_NOTIFICATION,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING);
        } else {
            startForeground(MONITOR_NOTIFICATION, notification);
        }
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        NotificationChannel monitor = new NotificationChannel(
                MONITOR_CHANNEL,
                getString(R.string.monitor_channel_name),
                NotificationManager.IMPORTANCE_LOW);
        monitor.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        NotificationChannel attention = new NotificationChannel(
                ATTENTION_CHANNEL,
                getString(R.string.attention_channel_name),
                NotificationManager.IMPORTANCE_HIGH);
        attention.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        manager.createNotificationChannel(monitor);
        manager.createNotificationChannel(attention);
    }

    private Notification notification(String message) {
        return new Notification.Builder(this, channel(MONITOR_CHANNEL))
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle(getString(R.string.monitor_notification_title))
                .setContentText(message)
                .setContentIntent(openAppIntent())
                .setOngoing(true)
                .setCategory(Notification.CATEGORY_SERVICE)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .build();
    }

    private void updateOngoing(String message) {
        getSystemService(NotificationManager.class)
                .notify(MONITOR_NOTIFICATION, notification(message));
    }

    private void notifyAttention(int count) {
        String text = count == 1 ? "有 1 个操作正在等待" : "有 " + count + " 个操作正在等待";
        Notification notice = new Notification.Builder(this, channel(ATTENTION_CHANNEL))
                .setSmallIcon(android.R.drawable.stat_notify_error)
                .setContentTitle(getString(R.string.attention_notification_title))
                .setContentText(text)
                .setContentIntent(openAppIntent())
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .build();
        getSystemService(NotificationManager.class).notify(ATTENTION_NOTIFICATION, notice);
    }

    private PendingIntent openAppIntent() {
        Intent intent = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(
                this,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private String channel(String channel) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? channel : "";
    }
}
