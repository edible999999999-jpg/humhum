package com.humhum.mobile;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.Test;

public class SessionSnapshotGenerationGateTest {
    @Test
    public void newerOwnerPreventsStaleTasksFromRunning() {
        SessionSnapshotGenerationGate oldOwner = SessionSnapshotGenerationGate.open();
        long oldGeneration = oldOwner.capture();
        SessionSnapshotGenerationGate newOwner = SessionSnapshotGenerationGate.open();
        AtomicBoolean ran = new AtomicBoolean();
        try {
            assertFalse(oldOwner.runIfCurrent(oldGeneration, () -> ran.set(true)));
            assertFalse(ran.get());
        } finally {
            oldOwner.close();
            newOwner.close();
        }
    }

    @Test
    public void renewInvalidatesPreviouslyCapturedGeneration() {
        SessionSnapshotGenerationGate gate = SessionSnapshotGenerationGate.open();
        long oldGeneration = gate.capture();
        try {
            long renewedGeneration = gate.renew();
            assertFalse(gate.isCurrent(oldGeneration));
            assertTrue(gate.isCurrent(renewedGeneration));
        } finally {
            gate.close();
        }
    }

    @Test
    public void closingOldOwnerCannotInvalidateNewOwner() {
        SessionSnapshotGenerationGate oldOwner = SessionSnapshotGenerationGate.open();
        SessionSnapshotGenerationGate newOwner = SessionSnapshotGenerationGate.open();
        long newGeneration = newOwner.capture();
        AtomicBoolean ran = new AtomicBoolean();
        try {
            oldOwner.close();
            assertTrue(newOwner.runIfCurrent(newGeneration, () -> ran.set(true)));
            assertTrue(ran.get());
        } finally {
            newOwner.close();
        }
    }

    @Test
    public void staleOwnerCannotRenewOverNewOwner() {
        SessionSnapshotGenerationGate oldOwner = SessionSnapshotGenerationGate.open();
        SessionSnapshotGenerationGate newOwner = SessionSnapshotGenerationGate.open();
        long newGeneration = newOwner.capture();
        try {
            assertThrows(IllegalStateException.class, oldOwner::renew);
            assertTrue(newOwner.isCurrent(newGeneration));
        } finally {
            oldOwner.close();
            newOwner.close();
        }
    }

    @Test
    public void renewWaitsForInProgressGuardedOperation() throws Exception {
        SessionSnapshotGenerationGate gate = SessionSnapshotGenerationGate.open();
        long generation = gate.capture();
        CountDownLatch operationStarted = new CountDownLatch(1);
        CountDownLatch releaseOperation = new CountDownLatch(1);
        CountDownLatch renewalStarted = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<Boolean> operation = executor.submit(() -> gate.runIfCurrent(generation, () -> {
                operationStarted.countDown();
                await(releaseOperation);
            }));
            assertTrue(operationStarted.await(1, TimeUnit.SECONDS));

            Future<Long> renewal = executor.submit(() -> {
                renewalStarted.countDown();
                return gate.renew();
            });
            assertTrue(renewalStarted.await(1, TimeUnit.SECONDS));
            try {
                renewal.get(100, TimeUnit.MILLISECONDS);
                fail("Renew must wait for the guarded operation");
            } catch (TimeoutException expected) {
                // Expected while the guarded operation owns the process-wide lock.
            }

            releaseOperation.countDown();
            assertTrue(operation.get(1, TimeUnit.SECONDS));
            assertTrue(gate.isCurrent(renewal.get(1, TimeUnit.SECONDS)));
        } finally {
            releaseOperation.countDown();
            executor.shutdownNow();
            gate.close();
        }
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(1, TimeUnit.SECONDS)) {
                throw new AssertionError("Timed out waiting for test release");
            }
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new AssertionError("Interrupted while waiting", error);
        }
    }
}
