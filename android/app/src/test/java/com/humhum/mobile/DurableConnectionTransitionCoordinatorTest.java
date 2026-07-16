package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;

public class DurableConnectionTransitionCoordinatorTest {
    @Test
    public void atomicBeginRejectsDuplicateAndConflictingTransitions() throws Exception {
        BlockingQueue<DurableConnectionTransitionCoordinator.Completion> completions =
                new LinkedBlockingQueue<>();
        DurableConnectionTransitionCoordinator coordinator =
                new DurableConnectionTransitionCoordinator(completions::add);
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        try {
            assertTrue(coordinator.begin(
                    DurableConnectionTransitionCoordinator.State.PAIRING,
                    () -> {
                        started.countDown();
                        await(release);
                        return "paired";
                    }));
            assertTrue(started.await(1, TimeUnit.SECONDS));
            assertEquals(
                    DurableConnectionTransitionCoordinator.State.PAIRING,
                    coordinator.state());
            assertFalse(coordinator.begin(
                    DurableConnectionTransitionCoordinator.State.PAIRING, () -> "duplicate"));
            assertFalse(coordinator.begin(
                    DurableConnectionTransitionCoordinator.State.DISCONNECTING,
                    () -> "conflict"));

            release.countDown();
            DurableConnectionTransitionCoordinator.Completion completion =
                    completions.poll(1, TimeUnit.SECONDS);
            assertNotNull(completion);
            assertEquals(DurableConnectionTransitionCoordinator.State.PAIRING, completion.state());
            assertEquals("paired", completion.notice());
            assertEquals(null, completion.failure());
            assertEquals(DurableConnectionTransitionCoordinator.State.IDLE, coordinator.state());
        } finally {
            release.countDown();
            coordinator.close();
        }
    }

    @Test
    public void failureFinallyReturnsToIdleAndAllowsNextTransition() throws Exception {
        BlockingQueue<DurableConnectionTransitionCoordinator.Completion> completions =
                new LinkedBlockingQueue<>();
        DurableConnectionTransitionCoordinator coordinator =
                new DurableConnectionTransitionCoordinator(completions::add);
        try {
            assertTrue(coordinator.begin(
                    DurableConnectionTransitionCoordinator.State.PAIRING,
                    () -> {
                        throw new IOException("pair failed");
                    }));
            DurableConnectionTransitionCoordinator.Completion failed =
                    completions.poll(1, TimeUnit.SECONDS);
            assertNotNull(failed);
            assertTrue(failed.failure() instanceof IOException);
            assertEquals(DurableConnectionTransitionCoordinator.State.IDLE, coordinator.state());

            assertTrue(coordinator.begin(
                    DurableConnectionTransitionCoordinator.State.DISCONNECTING,
                    () -> "cleared"));
            DurableConnectionTransitionCoordinator.Completion succeeded =
                    completions.poll(1, TimeUnit.SECONDS);
            assertNotNull(succeeded);
            assertEquals(
                    DurableConnectionTransitionCoordinator.State.DISCONNECTING,
                    succeeded.state());
            assertEquals("cleared", succeeded.notice());
            assertEquals(null, succeeded.failure());
        } finally {
            coordinator.close();
        }
    }

    @Test
    public void coordinatorOwnsOneProcessExecutorThread() throws Exception {
        BlockingQueue<DurableConnectionTransitionCoordinator.Completion> completions =
                new LinkedBlockingQueue<>();
        DurableConnectionTransitionCoordinator coordinator =
                new DurableConnectionTransitionCoordinator(completions::add);
        AtomicReference<Thread> pairingThread = new AtomicReference<>();
        AtomicReference<Thread> disconnectThread = new AtomicReference<>();
        try {
            assertTrue(coordinator.begin(
                    DurableConnectionTransitionCoordinator.State.PAIRING,
                    () -> {
                        pairingThread.set(Thread.currentThread());
                        return "paired";
                    }));
            assertNotNull(completions.poll(1, TimeUnit.SECONDS));
            assertTrue(coordinator.begin(
                    DurableConnectionTransitionCoordinator.State.DISCONNECTING,
                    () -> {
                        disconnectThread.set(Thread.currentThread());
                        return "cleared";
                    }));
            assertNotNull(completions.poll(1, TimeUnit.SECONDS));
            assertSame(pairingThread.get(), disconnectThread.get());
        } finally {
            coordinator.close();
        }
    }

    @Test
    public void completionWaitsForAStartedActivityToClaimIt() throws Exception {
        BlockingQueue<DurableConnectionTransitionCoordinator.Completion> notifications =
                new LinkedBlockingQueue<>();
        DurableConnectionTransitionCoordinator coordinator =
                new DurableConnectionTransitionCoordinator(notifications::add);
        try {
            assertTrue(coordinator.begin(
                    DurableConnectionTransitionCoordinator.State.DISCONNECTING,
                    () -> "桌面端未确认撤销"));
            DurableConnectionTransitionCoordinator.Completion notified =
                    notifications.poll(1, TimeUnit.SECONDS);
            assertNotNull(notified);

            assertSame(notified, coordinator.claimCompletion(notified));
            assertEquals(null, coordinator.claimCompletion());
            assertEquals(null, coordinator.claimCompletion(notified));
        } finally {
            coordinator.close();
        }
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(1, TimeUnit.SECONDS)) {
                throw new AssertionError("Timed out waiting for release");
            }
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new AssertionError("Interrupted while waiting", error);
        }
    }
}
