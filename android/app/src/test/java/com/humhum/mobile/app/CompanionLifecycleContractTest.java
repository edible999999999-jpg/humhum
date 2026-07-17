package com.humhum.mobile.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.Test;

public final class CompanionLifecycleContractTest {
    private static final Path ACTIVITY =
            Path.of("src/main/java/com/humhum/mobile/MainActivity.java");

    @Test
    public void durableTransitionsAndFailuresReconcileUiState() throws Exception {
        String source = activitySource();

        String adoption = methodSource(
                source, "private void adoptTransitionState()", "private void setDisconnecting(");
        assertOrdered(
                adoption,
                "State.PAIRING",
                "dispatchState(HumHumAction.PairingStarted.INSTANCE)",
                "setPairing(true)");
        assertOrdered(
                adoption,
                "State.DISCONNECTING",
                "dispatchState(HumHumAction.DisconnectStarted.INSTANCE)",
                "setDisconnecting(true)");

        String completion = methodSource(
                source,
                "private void handleTransitionCompletion(",
                "private void reconcileDurableConnection(");
        assertTrue(completion.contains("reconcileDurableConnection(completion.notice())"));
        assertOrdered(
                completion,
                "DurableConnectionTransitionCoordinator.State.DISCONNECTING",
                "new HumHumAction.ConnectionRestored(",
                "startCompanionPolling()");
    }

    @Test
    public void qrFailuresAndRejectedRefreshSubmissionsCannotLeavePendingState() throws Exception {
        String source = activitySource();

        String setup = methodSource(
                source, "private void applyPairingSetup(", "private void activate(");
        assertOrdered(
                setup,
                "} catch (IllegalArgumentException error) {",
                "new HumHumAction.PairingInputRejected(",
                "setScannedPairingState(false)");

        String refresh = methodSource(
                source, "private void refreshSessions(boolean userInitiated)",
                "private void commitSessionPage(");
        assertTrue(refresh.contains(
                "boolean accepted = companionRepository.executeNetwork(() -> {"));
        assertOrdered(
                refresh,
                "if (!accepted) {",
                "refreshInFlight = false;",
                "dispatchState(HumHumAction.RefreshCancelled.INSTANCE)",
                "refreshButton.setEnabled(true)");
    }

    @Test
    public void pollingCallbacksAreTrackedAndRemovedAtEveryLifecycleBoundary() throws Exception {
        String source = activitySource();
        assertTrue(source.contains("private final Runnable pollRefresh ="));
        assertTrue(source.contains("private boolean companionPollingActive;"));

        String resume = methodSource(source, "protected void onResume()", "protected void onStop()");
        assertTrue(resume.contains("startCompanionPolling();"));

        String stop = methodSource(source, "protected void onStop()", "protected void onDestroy()");
        assertOrdered(
                stop,
                "companionPollingActive = false;",
                "viewModel.stopPolling();",
                "main.removeCallbacks(pollRefresh);");

        String destroy = methodSource(
                source, "protected void onDestroy()", "private void bindViews()");
        assertOrdered(
                destroy,
                "companionPollingActive = false;",
                "main.removeCallbacks(pollRefresh);",
                "viewModel.close();");
    }

    @Test
    public void immutableStateDrivesLegacyRenderingAndRelayRecovery() throws Exception {
        String source = activitySource();

        String dispatch = methodSource(
                source, "private HumHumUiState dispatchState(", "private void renderUiState(");
        assertTrue(dispatch.contains("renderUiState(state);"));

        String rendering = methodSource(
                source, "private void renderUiState(", "private void renderSelectedRole()");
        assertTrue(rendering.contains("state.getSelectedRole()"));
        assertTrue(rendering.contains("state.getSessions()"));
        assertTrue(rendering.contains("state.getStatusMessage()"));
        assertTrue(rendering.contains("state.getCanControl()"));
        assertTrue(rendering.contains("state.getPendingActions()"));

        String commit = methodSource(
                source, "private void commitSessionPage(", "private void clearRevokedConnection(");
        assertTrue(commit.contains("new HumHumAction.RelayRecovered(page.sessions())"));
        assertTrue(commit.contains("new HumHumAction.SessionsLoaded(page.sessions(), false)"));
    }

    @Test
    public void legacyScreenDoesNotPretendTaskSixSettingsOrHealthEventsAreWired() throws Exception {
        String source = activitySource();
        assertFalse(source.contains("HumHumAction.OpenSettings"));
        assertFalse(source.contains("HumHumAction.HealthUpdated"));
    }

    private static String methodSource(String source, String start, String end) {
        int startIndex = source.indexOf(start);
        int endIndex = source.indexOf(end, startIndex);
        assertTrue("Missing method start: " + start, startIndex >= 0);
        assertTrue("Missing method end: " + end, endIndex > startIndex);
        return source.substring(startIndex, endIndex);
    }

    private static String activitySource() throws Exception {
        return new String(Files.readAllBytes(ACTIVITY), StandardCharsets.UTF_8);
    }

    private static void assertOrdered(String source, String... fragments) {
        int previous = -1;
        for (String fragment : fragments) {
            int index = source.indexOf(fragment, previous + 1);
            assertTrue("Missing or out-of-order source: " + fragment, index > previous);
            previous = index;
        }
    }
}
