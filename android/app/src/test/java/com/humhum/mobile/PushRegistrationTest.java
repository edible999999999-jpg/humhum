package com.humhum.mobile;

import static org.junit.Assert.assertEquals;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

public class PushRegistrationTest {
    @Test
    public void registrationRequiresConfigurationPairingRelayAndBoundedToken() {
        assertEquals(PushRegistration.Decision.REGISTER, PushRegistration.plan(
                true, true, true, "fcm:opaque-token"));
        assertEquals(PushRegistration.Decision.SKIP, PushRegistration.plan(
                false, true, true, "fcm:opaque-token"));
        assertEquals(PushRegistration.Decision.SKIP, PushRegistration.plan(
                true, false, true, "fcm:opaque-token"));
        assertEquals(PushRegistration.Decision.SKIP, PushRegistration.plan(
                true, true, false, "fcm:opaque-token"));
        assertEquals(PushRegistration.Decision.SKIP, PushRegistration.plan(
                true, true, true, ""));
        assertEquals(PushRegistration.Decision.SKIP, PushRegistration.plan(
                true, true, true, "A".repeat(4_097)));
        assertEquals(PushRegistration.Decision.SKIP, PushRegistration.plan(
                true, true, true, "token with spaces"));
    }

    @Test
    public void lateRegistrationIsRejectedAfterDisconnectOrChannelChange() {
        String channel = "11".repeat(32);
        assertEquals(true, PushRegistration.sameChannel(channel, channel));
        assertEquals(false, PushRegistration.sameChannel(channel, null));
        assertEquals(false, PushRegistration.sameChannel(channel, "22".repeat(32)));
    }

    @Test
    public void coordinatorRetriesTransientFailureThenCommitsSuccess() {
        FakeScheduler scheduler = new FakeScheduler();
        List<PushStateStore.State> states = new ArrayList<>();
        int[] attempts = {0};
        PushRegistration.Coordinator coordinator = new PushRegistration.Coordinator(
                scheduler,
                () -> relay("11"),
                (relay, token) -> {
                    attempts[0]++;
                    if (attempts[0] == 1) throw new IOException("offline");
                },
                sink(states));

        coordinator.start("11".repeat(32), "fcm:token");
        assertEquals(List.of(0L), scheduler.delays);
        scheduler.runNext();
        assertEquals(List.of(0L, 15L), scheduler.delays);
        scheduler.runNext();

        assertEquals(2, attempts[0]);
        assertEquals(List.of(
                PushStateStore.State.REGISTERING,
                PushStateStore.State.RETRYING,
                PushStateStore.State.REGISTERED), states);
    }

    @Test
    public void coordinatorStopsOnRevokedChannelWithoutLooping() {
        FakeScheduler scheduler = new FakeScheduler();
        List<PushStateStore.State> states = new ArrayList<>();
        PushRegistration.Coordinator coordinator = new PushRegistration.Coordinator(
                scheduler,
                () -> relay("11"),
                (relay, token) -> { throw new WakeRelayClient.RelayStatusException(401); },
                sink(states));

        coordinator.start("11".repeat(32), "fcm:token");
        scheduler.runNext();

        assertEquals(List.of(0L), scheduler.delays);
        assertEquals(List.of(
                PushStateStore.State.REGISTERING,
                PushStateStore.State.NEEDS_PAIRING), states);
    }

    @Test
    public void cancelAndChannelChangeRejectLateEffects() {
        FakeScheduler cancelledScheduler = new FakeScheduler();
        int[] calls = {0};
        RecordingSink cancelledStates = new RecordingSink();
        PushRegistration.Coordinator cancelled = new PushRegistration.Coordinator(
                cancelledScheduler,
                () -> relay("11"),
                (relay, token) -> calls[0]++,
                cancelledStates);
        cancelled.start("11".repeat(32), "fcm:token");
        cancelled.cancel();
        cancelledScheduler.runNext();
        assertEquals(0, calls[0]);
        assertEquals(1, cancelledStates.clears);

        FakeScheduler changedScheduler = new FakeScheduler();
        Models.WakeRelayConfig[] current = {relay("11")};
        List<PushStateStore.State> changedStates = new ArrayList<>();
        PushRegistration.Coordinator changed = new PushRegistration.Coordinator(
                changedScheduler,
                () -> current[0],
                (relay, token) -> current[0] = relay("22"),
                sink(changedStates));
        changed.start("11".repeat(32), "fcm:token");
        changedScheduler.runNext();
        assertEquals(List.of(PushStateStore.State.REGISTERING), changedStates);
    }

    private static Models.WakeRelayConfig relay(String bytePair) {
        return new Models.WakeRelayConfig(
                "https://relay.example.com",
                bytePair.repeat(32),
                "33".repeat(32),
                "44".repeat(32));
    }

    private static PushRegistration.StateSink sink(List<PushStateStore.State> states) {
        return new PushRegistration.StateSink() {
            @Override public void save(PushStateStore.State state, String channel) {
                states.add(state);
            }
            @Override public void clear() {}
        };
    }

    private static final class RecordingSink implements PushRegistration.StateSink {
        int clears;
        @Override public void save(PushStateStore.State state, String channel) {}
        @Override public void clear() { clears++; }
    }

    private static final class FakeScheduler implements PushRegistration.Scheduler {
        final List<Long> delays = new ArrayList<>();
        final List<Runnable> tasks = new ArrayList<>();
        @Override public void schedule(Runnable task, long delaySeconds) {
            delays.add(delaySeconds);
            tasks.add(task);
        }
        void runNext() { tasks.remove(0).run(); }
    }
}
