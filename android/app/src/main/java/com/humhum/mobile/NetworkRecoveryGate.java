package com.humhum.mobile;

public final class NetworkRecoveryGate {
    private boolean available;

    public synchronized boolean onNetworkAvailable() {
        if (available) return false;
        available = true;
        return true;
    }

    public synchronized void onNetworkLost() {
        available = false;
    }
}
