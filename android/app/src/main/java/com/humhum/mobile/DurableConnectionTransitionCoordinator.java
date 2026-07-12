package com.humhum.mobile;

import java.util.Objects;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

final class DurableConnectionTransitionCoordinator implements AutoCloseable {
    enum State {
        IDLE,
        PAIRING,
        DISCONNECTING
    }

    @FunctionalInterface
    interface Work {
        String run() throws Exception;
    }

    static final class Completion {
        private final State state;
        private final String notice;
        private final Throwable failure;

        Completion(State state, String notice, Throwable failure) {
            this.state = state;
            this.notice = notice == null ? "" : notice;
            this.failure = failure;
        }

        State state() { return state; }
        String notice() { return notice; }
        Throwable failure() { return failure; }
    }

    private final ExecutorService executor;
    private final Consumer<Completion> observer;
    private State state = State.IDLE;

    DurableConnectionTransitionCoordinator(Consumer<Completion> observer) {
        this(Executors.newSingleThreadExecutor(), observer);
    }

    DurableConnectionTransitionCoordinator(
            ExecutorService executor, Consumer<Completion> observer) {
        this.executor = Objects.requireNonNull(executor, "executor");
        this.observer = Objects.requireNonNull(observer, "observer");
    }

    synchronized State state() {
        return state;
    }

    boolean begin(State requested, Work work) {
        Objects.requireNonNull(requested, "requested");
        Objects.requireNonNull(work, "work");
        if (requested == State.IDLE) throw new IllegalArgumentException("Transition must do work");
        synchronized (this) {
            if (state != State.IDLE) return false;
            state = requested;
            try {
                executor.execute(() -> execute(requested, work));
            } catch (RuntimeException error) {
                state = State.IDLE;
                throw error;
            }
            return true;
        }
    }

    @Override
    public void close() {
        executor.shutdownNow();
    }

    private void execute(State runningState, Work work) {
        String notice = "";
        Throwable failure = null;
        try {
            notice = work.run();
        } catch (Throwable error) {
            failure = error;
        } finally {
            Completion completion = new Completion(runningState, notice, failure);
            synchronized (this) {
                state = State.IDLE;
            }
            observer.accept(completion);
        }
    }
}
