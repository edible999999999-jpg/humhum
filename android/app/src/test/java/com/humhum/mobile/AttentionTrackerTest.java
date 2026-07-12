package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.junit.Test;

public class AttentionTrackerTest {
    @Test
    public void reportsCurrentApprovalsOnceAndOnlyNewApprovalsLater() {
        AttentionTracker tracker = new AttentionTracker(List.of());
        Models.SessionPage first = page(actions("one", "two"));

        AttentionTracker.Result initial = tracker.evaluate(first);
        AttentionTracker.Result repeated = tracker.evaluate(first);
        AttentionTracker.Result added = tracker.evaluate(page(actions("one", "two", "three")));

        assertEquals(2, initial.newCount());
        assertEquals(0, repeated.newCount());
        assertEquals(1, added.newCount());
        assertEquals(3, added.knownDigests().size());
    }

    @Test
    public void storesOnlyBoundedSha256Digests() {
        List<Models.Action> actions = new ArrayList<>();
        for (int index = 0; index < 220; index++) {
            actions.add(new Models.Action("approval-" + index, "codex", "command", "private"));
        }

        AttentionTracker.Result result = new AttentionTracker(List.of()).evaluate(page(actions));

        assertEquals(200, result.knownDigests().size());
        assertTrue(result.knownDigests().stream().allMatch(value -> value.matches("[a-f0-9]{64}")));
    }

    @Test
    public void digestEncodingDoesNotDependOnDeviceLocale() {
        Locale previous = Locale.getDefault();
        try {
            Locale.setDefault(Locale.forLanguageTag("ar"));
            AttentionTracker.Result result = new AttentionTracker(List.of())
                    .evaluate(page(actions("approval")));

            assertTrue(result.knownDigests().get(0).matches("[a-f0-9]{64}"));
        } finally {
            Locale.setDefault(previous);
        }
    }

    private static List<Models.Action> actions(String... ids) {
        List<Models.Action> actions = new ArrayList<>();
        for (String id : ids) {
            actions.add(new Models.Action(id, "codex", "command", "private summary"));
        }
        return actions;
    }

    private static Models.SessionPage page(List<Models.Action> actions) {
        Models.Session session = new Models.Session(
                "session-1", "codex", "private project", "waiting", "now",
                true, true, actions);
        return new Models.SessionPage(Models.Scope.CONTROL, List.of(session));
    }
}
