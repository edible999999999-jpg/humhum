package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
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
}
