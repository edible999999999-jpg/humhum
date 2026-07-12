package com.humhum.mobile;

import android.content.Context;
import com.google.firebase.messaging.FirebaseMessaging;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public final class PushRegistration {
    private static final ScheduledExecutorService NETWORK = Executors.newSingleThreadScheduledExecutor();
    private static Coordinator coordinator;
    public enum Decision { REGISTER, SKIP }

    interface Scheduler {
        void schedule(Runnable task, long delaySeconds);
    }

    interface RelaySource {
        Models.WakeRelayConfig current();
    }

    interface Registrar {
        void register(Models.WakeRelayConfig relay, String token) throws Exception;
    }

    interface StateSink {
        void save(PushStateStore.State state, String channel);
        void clear();
    }

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
        Context application = context.getApplicationContext();
        if (!HumHumApplication.isFcmConfigured()) {
            cancel(application);
            return;
        }
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
        coordinator(application).start(connection.wakeRelay().channelId(), token);
    }

    public static void cancel(Context context) {
        Context application = context.getApplicationContext();
        synchronized (PushRegistration.class) {
            if (coordinator != null) coordinator.cancel();
            else pushStateStore(application).clear();
        }
    }

    public static PushStateStore stateStore(Context context) {
        return pushStateStore(context.getApplicationContext());
    }

    static boolean sameChannel(String expected, String current) {
        return expected != null && expected.matches("[a-f0-9]{64}") && expected.equals(current);
    }

    private static ConnectionStore connectionStore(Context context) {
        return new ConnectionStore(
                context.getSharedPreferences("humhum_connection", Context.MODE_PRIVATE));
    }

    private static PushStateStore pushStateStore(Context context) {
        return new PushStateStore(
                context.getSharedPreferences("humhum_push", Context.MODE_PRIVATE));
    }

    private static synchronized Coordinator coordinator(Context context) {
        if (coordinator != null) return coordinator;
        Context application = context.getApplicationContext();
        PushStateStore states = pushStateStore(application);
        coordinator = new Coordinator(
                (task, delay) -> NETWORK.schedule(task, delay, TimeUnit.SECONDS),
                () -> {
                    ConnectionStore.Connection current = connectionStore(application).load();
                    return current == null ? null : current.wakeRelay();
                },
                (relay, token) -> new WakeRelayClient().putPushToken(relay, token),
                new StateSink() {
                    @Override public void save(PushStateStore.State state, String channel) {
                        states.save(state, channel);
                    }
                    @Override public void clear() {
                        states.clear();
                    }
                });
        return coordinator;
    }

    static final class Coordinator {
        private final Scheduler scheduler;
        private final RelaySource relays;
        private final Registrar registrar;
        private final StateSink states;
        private int generation;

        Coordinator(Scheduler scheduler, RelaySource relays, Registrar registrar, StateSink states) {
            this.scheduler = scheduler;
            this.relays = relays;
            this.registrar = registrar;
            this.states = states;
        }

        synchronized void start(String channel, String token) {
            if (channel == null
                    || !channel.matches("[a-f0-9]{64}")
                    || token == null
                    || !token.matches("[\\x21-\\x7e]{1,4096}")) return;
            int currentGeneration = ++generation;
            states.save(PushStateStore.State.REGISTERING, channel);
            scheduler.schedule(() -> attempt(currentGeneration, channel, token, 0), 0);
        }

        synchronized void cancel() {
            generation++;
            states.clear();
        }

        private void attempt(int expectedGeneration, String channel, String token, int failureIndex) {
            Models.WakeRelayConfig relay;
            synchronized (this) {
                relay = currentRelay(expectedGeneration, channel);
                if (relay == null) return;
            }
            try {
                registrar.register(relay, token);
            } catch (WakeRelayClient.RelayStatusException error) {
                fail(expectedGeneration, channel, token, failureIndex,
                        PushRetryPolicy.forStatus(error.status()));
                return;
            } catch (Exception error) {
                fail(expectedGeneration, channel, token, failureIndex,
                        PushRetryPolicy.Outcome.RETRY);
                return;
            }
            synchronized (this) {
                if (currentRelay(expectedGeneration, channel) != null) {
                    states.save(PushStateStore.State.REGISTERED, channel);
                }
            }
        }

        private synchronized void fail(
                int expectedGeneration,
                String channel,
                String token,
                int failureIndex,
                PushRetryPolicy.Outcome outcome) {
            if (currentRelay(expectedGeneration, channel) == null) return;
            if (outcome == PushRetryPolicy.Outcome.RETRY) {
                states.save(PushStateStore.State.RETRYING, channel);
                long delay = PushRetryPolicy.delaySeconds(failureIndex);
                scheduler.schedule(
                        () -> attempt(expectedGeneration, channel, token, failureIndex + 1),
                        delay);
            } else {
                states.save(PushStateStore.State.NEEDS_PAIRING, channel);
            }
        }

        private Models.WakeRelayConfig currentRelay(int expectedGeneration, String channel) {
            if (expectedGeneration != generation) return null;
            Models.WakeRelayConfig current = relays.current();
            return current != null && sameChannel(channel, current.channelId()) ? current : null;
        }
    }
}
