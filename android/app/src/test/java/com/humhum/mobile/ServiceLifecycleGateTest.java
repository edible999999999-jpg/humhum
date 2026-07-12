package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.Test;

public class ServiceLifecycleGateTest {
    @Test
    public void closeRejectsEveryLaterCommit() {
        ServiceLifecycleGate gate = new ServiceLifecycleGate();
        int[] effects = {0};

        assertTrue(gate.commit(() -> effects[0]++));
        gate.close(() -> effects[0]++);

        assertFalse(gate.commit(() -> effects[0]++));
        assertEquals(2, effects[0]);
    }

    @Test
    public void closeWaitsForAnInFlightCommitThenBecomesFinal() throws Exception {
        ServiceLifecycleGate gate = new ServiceLifecycleGate();
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch closed = new CountDownLatch(1);
        Thread commit = new Thread(() -> gate.commit(() -> {
            entered.countDown();
            try {
                release.await();
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
            }
        }));
        Thread close = new Thread(() -> {
            gate.close(closed::countDown);
        });

        commit.start();
        assertTrue(entered.await(1, TimeUnit.SECONDS));
        close.start();
        assertFalse(closed.await(50, TimeUnit.MILLISECONDS));
        release.countDown();
        assertTrue(closed.await(1, TimeUnit.SECONDS));
        commit.join();
        close.join();
        assertFalse(gate.commit(() -> {}));
    }
}
