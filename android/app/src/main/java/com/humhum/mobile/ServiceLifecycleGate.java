package com.humhum.mobile;

final class ServiceLifecycleGate {
    private boolean closed;

    synchronized boolean commit(Runnable action) {
        if (closed) return false;
        action.run();
        return true;
    }

    synchronized void close(Runnable action) {
        if (closed) return;
        closed = true;
        action.run();
    }
}
