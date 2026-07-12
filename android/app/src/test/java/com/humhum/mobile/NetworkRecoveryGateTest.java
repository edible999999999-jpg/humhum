package com.humhum.mobile;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class NetworkRecoveryGateTest {
    @Test
    public void availabilitySchedulesOnlyOnceUntilTheNetworkIsLost() {
        NetworkRecoveryGate gate = new NetworkRecoveryGate();

        assertTrue(gate.onNetworkAvailable());
        assertFalse(gate.onNetworkAvailable());
        assertFalse(gate.onNetworkAvailable());

        gate.onNetworkLost();

        assertTrue(gate.onNetworkAvailable());
        assertFalse(gate.onNetworkAvailable());
    }

    @Test
    public void repeatedLossKeepsTheNextAvailabilityArmed() {
        NetworkRecoveryGate gate = new NetworkRecoveryGate();
        gate.onNetworkLost();
        gate.onNetworkLost();

        assertTrue(gate.onNetworkAvailable());
    }
}
