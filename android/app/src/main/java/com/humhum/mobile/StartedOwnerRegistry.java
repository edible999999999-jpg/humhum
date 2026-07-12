package com.humhum.mobile;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.function.Consumer;

final class StartedOwnerRegistry<T> {
    private final List<WeakReference<T>> started = new ArrayList<>();

    synchronized void start(T owner) {
        T checked = Objects.requireNonNull(owner, "owner");
        removeDeadAnd(checked);
        started.add(new WeakReference<>(checked));
    }

    synchronized void stop(T owner) {
        removeDeadAnd(owner);
    }

    synchronized boolean isCurrent(T owner) {
        return currentOwner() == owner;
    }

    void dispatch(Consumer<T> consumer) {
        Objects.requireNonNull(consumer, "consumer");
        T owner;
        synchronized (this) {
            owner = currentOwner();
        }
        if (owner != null) consumer.accept(owner);
    }

    private T currentOwner() {
        for (int index = started.size() - 1; index >= 0; index--) {
            T owner = started.get(index).get();
            if (owner != null) return owner;
            started.remove(index);
        }
        return null;
    }

    private void removeDeadAnd(T removedOwner) {
        for (int index = started.size() - 1; index >= 0; index--) {
            T owner = started.get(index).get();
            if (owner == null || owner == removedOwner) started.remove(index);
        }
    }
}
