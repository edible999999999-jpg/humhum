package com.humhum.mobile;

import java.lang.ref.WeakReference;
import java.util.Objects;
import java.util.function.Consumer;

final class StartedOwnerRegistry<T> {
    private WeakReference<T> current = new WeakReference<>(null);

    synchronized void start(T owner) {
        current = new WeakReference<>(Objects.requireNonNull(owner, "owner"));
    }

    synchronized void stop(T owner) {
        if (current.get() == owner) current.clear();
    }

    synchronized boolean isCurrent(T owner) {
        return current.get() == owner;
    }

    void dispatch(Consumer<T> consumer) {
        Objects.requireNonNull(consumer, "consumer");
        T owner;
        synchronized (this) {
            owner = current.get();
        }
        if (owner != null) consumer.accept(owner);
    }
}
