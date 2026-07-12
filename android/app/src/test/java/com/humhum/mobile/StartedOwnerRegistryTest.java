package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

public class StartedOwnerRegistryTest {
    @Test
    public void dispatchesOnlyToLatestStartedOwner() {
        StartedOwnerRegistry<Object> registry = new StartedOwnerRegistry<>();
        Object oldOwner = new Object();
        Object replacement = new Object();
        List<Object> notified = new ArrayList<>();

        registry.start(oldOwner);
        registry.start(replacement);
        registry.dispatch(notified::add);

        assertEquals(List.of(replacement), notified);
        assertFalse(registry.isCurrent(oldOwner));
        assertTrue(registry.isCurrent(replacement));
    }

    @Test
    public void oldStopCannotUnregisterReplacement() {
        StartedOwnerRegistry<Object> registry = new StartedOwnerRegistry<>();
        Object oldOwner = new Object();
        Object replacement = new Object();
        List<Object> notified = new ArrayList<>();

        registry.start(oldOwner);
        registry.start(replacement);
        registry.stop(oldOwner);
        registry.dispatch(notified::add);

        assertEquals(List.of(replacement), notified);
    }

    @Test
    public void stoppedCurrentOwnerReceivesNoDispatch() {
        StartedOwnerRegistry<Object> registry = new StartedOwnerRegistry<>();
        Object owner = new Object();
        List<Object> notified = new ArrayList<>();

        registry.start(owner);
        registry.stop(owner);
        registry.dispatch(notified::add);

        assertTrue(notified.isEmpty());
        assertFalse(registry.isCurrent(owner));
    }

    @Test
    public void stoppingReplacementRestoresPreviousStartedOwner() {
        StartedOwnerRegistry<Object> registry = new StartedOwnerRegistry<>();
        Object previous = new Object();
        Object replacement = new Object();
        List<Object> notified = new ArrayList<>();

        registry.start(previous);
        registry.start(replacement);
        registry.stop(replacement);
        registry.dispatch(notified::add);

        assertEquals(List.of(previous), notified);
        assertTrue(registry.isCurrent(previous));
        assertFalse(registry.isCurrent(replacement));
    }

    @Test
    public void olderStopDoesNotInvalidateCurrentOwnersGeneration() {
        StartedOwnerRegistry<GateOwner> registry = new StartedOwnerRegistry<>();
        GateOwner first = new GateOwner();
        GateOwner replacement = new GateOwner();
        long replacementGeneration = replacement.gate.capture();
        try {
            registry.start(first);
            registry.start(replacement);
            GateOwner fallback = registry.stop(first);
            if (fallback != null && !fallback.gate.isLatestOwner()) {
                fallback.gate.claimLatestOwner();
            }

            assertNull(fallback);
            assertTrue(registry.isCurrent(replacement));
            assertTrue(replacement.gate.isCurrent(replacementGeneration));
        } finally {
            first.gate.close();
            replacement.gate.close();
        }
    }

    @Test
    public void currentStopReturnsPreviousOwnerForReclaimAndReconciliation() {
        StartedOwnerRegistry<GateOwner> registry = new StartedOwnerRegistry<>();
        GateOwner first = new GateOwner();
        GateOwner replacement = new GateOwner();
        try {
            registry.start(first);
            registry.start(replacement);
            GateOwner fallback = registry.stop(replacement);
            if (fallback != null && !fallback.gate.isLatestOwner()) {
                fallback.gate.claimLatestOwner();
            }

            assertSame(first, fallback);
            assertTrue(registry.isCurrent(first));
            assertTrue(first.gate.isCurrent(first.gate.capture()));
        } finally {
            first.gate.close();
            replacement.gate.close();
        }
    }

    private static final class GateOwner {
        final SessionSnapshotGenerationGate gate = SessionSnapshotGenerationGate.open();
    }
}
