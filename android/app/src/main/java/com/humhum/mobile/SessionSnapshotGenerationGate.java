package com.humhum.mobile;

import java.util.Objects;
import java.util.function.Supplier;

final class SessionSnapshotGenerationGate implements AutoCloseable {
    private static final Object PROCESS_LOCK = new Object();
    private static long generationCounter;
    private static long activeGeneration;
    private static long ownerCounter;
    private static long latestOwnerId;

    private final long ownerId;
    private long ownedGeneration;

    private SessionSnapshotGenerationGate(long generation, long ownerId) {
        ownedGeneration = generation;
        this.ownerId = ownerId;
    }

    static SessionSnapshotGenerationGate open() {
        synchronized (PROCESS_LOCK) {
            long generation = nextGeneration();
            long ownerId = nextOwnerId();
            activeGeneration = generation;
            latestOwnerId = ownerId;
            return new SessionSnapshotGenerationGate(generation, ownerId);
        }
    }

    long capture() {
        synchronized (PROCESS_LOCK) {
            requireOpen();
            return ownedGeneration;
        }
    }

    long renew() {
        synchronized (PROCESS_LOCK) {
            requireOpen();
            if (activeGeneration != ownedGeneration) {
                throw new IllegalStateException("Generation owner is stale");
            }
            ownedGeneration = nextGeneration();
            activeGeneration = ownedGeneration;
            return ownedGeneration;
        }
    }

    boolean isCurrent(long generation) {
        synchronized (PROCESS_LOCK) {
            return isCurrentLocked(generation);
        }
    }

    boolean isLatestOwner() {
        synchronized (PROCESS_LOCK) {
            return ownedGeneration != 0L && ownerId == latestOwnerId;
        }
    }

    boolean runIfCurrent(long generation, Runnable operation) {
        Objects.requireNonNull(operation, "operation");
        synchronized (PROCESS_LOCK) {
            if (!isCurrentLocked(generation)) return false;
            operation.run();
            return true;
        }
    }

    <T> T callIfCurrent(long generation, Supplier<T> operation, T staleValue) {
        Objects.requireNonNull(operation, "operation");
        synchronized (PROCESS_LOCK) {
            if (!isCurrentLocked(generation)) return staleValue;
            return operation.get();
        }
    }

    static void runExclusiveTransition(Runnable operation) {
        Objects.requireNonNull(operation, "operation");
        callExclusiveTransition(() -> {
            operation.run();
            return null;
        });
    }

    static <T> T callExclusiveTransition(Supplier<T> operation) {
        Objects.requireNonNull(operation, "operation");
        synchronized (PROCESS_LOCK) {
            try {
                // Keep this to snapshot/connection persistence; Keystore latency blocks the lock.
                return operation.get();
            } finally {
                activeGeneration = nextGeneration();
            }
        }
    }

    @Override
    public void close() {
        synchronized (PROCESS_LOCK) {
            if (ownedGeneration == 0L) return;
            if (activeGeneration == ownedGeneration) {
                activeGeneration = nextGeneration();
            }
            ownedGeneration = 0L;
        }
    }

    private boolean isCurrentLocked(long generation) {
        return ownedGeneration != 0L
                && generation == ownedGeneration
                && generation == activeGeneration;
    }

    private void requireOpen() {
        if (ownedGeneration == 0L) throw new IllegalStateException("Generation owner is closed");
    }

    private static long nextGeneration() {
        generationCounter++;
        if (generationCounter == 0L) generationCounter++;
        return generationCounter;
    }

    private static long nextOwnerId() {
        ownerCounter++;
        if (ownerCounter == 0L) ownerCounter++;
        return ownerCounter;
    }
}
