package com.humhum.mobile.app

import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.Models
import com.humhum.mobile.health.HealthFreshness
import com.humhum.mobile.health.HealthSourceState
import com.humhum.mobile.health.HealthSummary
import com.humhum.mobile.health.HealthUiState
import java.time.Instant
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class HumHumViewModelTest {
    private lateinit var repository: MobileCompanionRepository
    private lateinit var viewModel: HumHumViewModel

    @Before
    fun setUp() {
        repository = MobileCompanionRepository()
        viewModel = HumHumViewModel(repository)
    }

    @After
    fun tearDown() {
        viewModel.close()
    }

    @Test
    fun unpairedScanningPairingAndConnectedTransitionsAreExplicit() {
        assertEquals(ConnectionStatus.UNPAIRED, viewModel.state.value.connection)

        viewModel.dispatch(HumHumAction.ScanStarted)
        assertEquals(ConnectionStatus.SCANNING, viewModel.state.value.connection)

        viewModel.dispatch(HumHumAction.PairingStarted)
        assertEquals(ConnectionStatus.PAIRING, viewModel.state.value.connection)

        viewModel.dispatch(HumHumAction.Connected(Models.Scope.CONTROL))
        assertEquals(ConnectionStatus.CONNECTED, viewModel.state.value.connection)
        assertTrue(viewModel.state.value.canControl)
    }

    @Test
    fun roleSelectionWorksAndSettingsStateIsReservedForTaskSix() {
        viewModel.dispatch(HumHumAction.SelectRole(MobileRoleDashboard.Role.HUSH))
        viewModel.dispatch(HumHumAction.OpenSettings)

        assertEquals(MobileRoleDashboard.Role.HUSH, viewModel.state.value.selectedRole)
        assertTrue(viewModel.state.value.settingsVisible)

        viewModel.dispatch(HumHumAction.CloseSettings)
        assertFalse(viewModel.state.value.settingsVisible)
    }

    @Test
    fun refreshAndRelayRecoveryReplaceSessions() {
        viewModel.dispatch(HumHumAction.Connected(Models.Scope.CONTROL))
        viewModel.dispatch(HumHumAction.RefreshRequested(userInitiated = true))
        assertTrue(viewModel.state.value.refreshInFlight)

        viewModel.dispatch(HumHumAction.SessionsLoaded(listOf(session("local")), viaRelay = false))
        assertFalse(viewModel.state.value.refreshInFlight)
        assertEquals("local", viewModel.state.value.sessions.single().id())

        viewModel.dispatch(HumHumAction.RelayRecovered(listOf(session("remote"))))
        assertTrue(viewModel.state.value.relayRecovered)
        assertEquals("remote", viewModel.state.value.sessions.single().id())
    }

    @Test
    fun offlineSnapshotRemainsVisibleWithoutPretendingToBeOnline() {
        viewModel.dispatch(HumHumAction.Connected(Models.Scope.READ))
        viewModel.dispatch(
            HumHumAction.OfflineSnapshotLoaded(
                sessions = listOf(session("cached")),
                ageCopy = "12 分钟前同步",
            ),
        )

        assertEquals(ConnectionStatus.OFFLINE, viewModel.state.value.connection)
        assertTrue(viewModel.state.value.offlineSnapshot)
        assertEquals("12 分钟前同步", viewModel.state.value.statusMessage)
        assertEquals("cached", viewModel.state.value.sessions.single().id())
    }

    @Test
    fun conversationDisclosureLoadsAndCollapses() {
        viewModel.dispatch(HumHumAction.Connected(Models.Scope.CONTROL))
        viewModel.dispatch(
            HumHumAction.SessionsLoaded(listOf(session("session-1")), viaRelay = false),
        )
        viewModel.dispatch(HumHumAction.OpenConversation("session-1"))
        assertTrue(viewModel.state.value.conversation.loading)

        viewModel.dispatch(
            HumHumAction.ConversationLoaded(
                "session-1",
                listOf(Models.ConversationMessage(Models.ConversationRole.USER, "hello")),
            ),
        )
        assertFalse(viewModel.state.value.conversation.loading)
        assertEquals("hello", viewModel.state.value.conversation.messages.single().text())

        viewModel.dispatch(HumHumAction.CloseConversation)
        assertNull(viewModel.state.value.conversation.sessionId)
    }

    @Test
    fun approvalAndFollowUpTrackPendingControlWork() {
        viewModel.dispatch(HumHumAction.Connected(Models.Scope.CONTROL))
        viewModel.dispatch(
            HumHumAction.SessionsLoaded(
                listOf(session("session-1"), session("session-2")),
                viaRelay = false,
            ),
        )
        viewModel.dispatch(HumHumAction.ApprovalStarted("session-1", "action-1"))
        viewModel.dispatch(HumHumAction.FollowUpStarted("session-2"))
        assertEquals(2, viewModel.state.value.pendingActions.size)

        viewModel.dispatch(HumHumAction.ApprovalFinished("session-1", "action-1"))
        viewModel.dispatch(HumHumAction.FollowUpFinished("session-2"))
        assertTrue(viewModel.state.value.pendingActions.isEmpty())
    }

    @Test
    fun readScopeNeverExposesServerSuppliedControlActions() {
        viewModel.dispatch(HumHumAction.Connected(Models.Scope.READ))
        viewModel.dispatch(HumHumAction.SessionsLoaded(listOf(session("read")), viaRelay = false))
        viewModel.dispatch(HumHumAction.ApprovalStarted("read", "action-1"))
        viewModel.dispatch(HumHumAction.FollowUpStarted("read"))

        val visible = viewModel.state.value.sessions.single()
        assertFalse(viewModel.state.value.canControl)
        assertFalse(visible.canMessage())
        assertTrue(visible.actions().isEmpty())
        assertTrue(viewModel.state.value.pendingActions.isEmpty())
    }

    @Test
    fun monitorDeviceCareAndHealthPermissionResultAreRepresented() {
        viewModel.dispatch(HumHumAction.MonitorChanged(enabled = true, permissionRequired = false))
        viewModel.dispatch(
            HumHumAction.DeviceCareChanged(
                batteryOptimized = false,
                autostartAvailable = true,
                pushReady = true,
            ),
        )
        viewModel.dispatch(
            HumHumAction.HealthPermissionResult(
                granted = setOf(HealthPermission.STEPS, HealthPermission.SLEEP),
                backgroundGranted = false,
            ),
        )

        val state = viewModel.state.value
        assertTrue(state.monitor.enabled)
        assertTrue(state.deviceCare.autostartAvailable)
        assertEquals(setOf(HealthPermission.STEPS, HealthPermission.SLEEP), state.healthPermissions.granted)
        assertFalse(state.healthPermissions.backgroundGranted)
    }

    @Test
    fun healthSummaryCanBeUpdatedWithoutMakingItDurableOnPhone() {
        val health = HealthUiState(
            summary = HealthSummary(
                steps = 6_342.0,
                restingHeartRate = 61.0,
                sleepMinutes = 438.0,
                capturedAt = Instant.parse("2026-07-17T08:00:00Z"),
                sourceStates = mapOf(
                    com.humhum.mobile.health.HealthMetric.STEPS to HealthSourceState.HEALTH_CONNECT,
                ),
            ),
            freshness = HealthFreshness.FRESH,
            notices = emptyList(),
            enqueuedSignals = 3,
        )

        viewModel.dispatch(HumHumAction.HealthUpdated(health))
        assertEquals(6_342.0, viewModel.state.value.health?.summary?.steps ?: 0.0, 0.0)
    }

    @Test
    fun disconnectClearsSensitiveAndControlState() {
        viewModel.dispatch(HumHumAction.Connected(Models.Scope.CONTROL))
        viewModel.dispatch(HumHumAction.SessionsLoaded(listOf(session("one")), viaRelay = false))
        viewModel.dispatch(HumHumAction.OpenConversation("one"))
        viewModel.dispatch(HumHumAction.DisconnectStarted)
        assertEquals(ConnectionStatus.DISCONNECTING, viewModel.state.value.connection)

        viewModel.dispatch(HumHumAction.Disconnected)
        val state = viewModel.state.value
        assertEquals(ConnectionStatus.UNPAIRED, state.connection)
        assertNull(state.scope)
        assertTrue(state.sessions.isEmpty())
        assertNull(state.conversation.sessionId)
        assertTrue(state.pendingActions.isEmpty())
    }

    @Test
    fun failedDisconnectRestoresConnectedControlStateAndSessions() {
        viewModel.dispatch(HumHumAction.Connected(Models.Scope.CONTROL))
        viewModel.dispatch(HumHumAction.SessionsLoaded(listOf(session("one")), viaRelay = false))
        viewModel.dispatch(HumHumAction.DisconnectStarted)

        viewModel.dispatch(
            HumHumAction.ConnectionRestored(
                scope = Models.Scope.CONTROL,
                message = "桌面端未确认断开",
            ),
        )

        val state = viewModel.state.value
        assertEquals(ConnectionStatus.CONNECTED, state.connection)
        assertEquals(Models.Scope.CONTROL, state.scope)
        assertTrue(state.canControl)
        assertEquals("one", state.sessions.single().id())
        assertEquals("桌面端未确认断开", state.statusMessage)
    }

    @Test
    fun rejectedQrRestoresTheConnectionStateThatExistedBeforeScanning() {
        viewModel.dispatch(HumHumAction.ScanStarted)
        viewModel.dispatch(HumHumAction.PairingInputRejected("二维码无效"))
        assertEquals(ConnectionStatus.UNPAIRED, viewModel.state.value.connection)
        assertEquals("二维码无效", viewModel.state.value.errorMessage)

        viewModel.dispatch(HumHumAction.Connected(Models.Scope.CONTROL))
        viewModel.dispatch(HumHumAction.ScanStarted)
        viewModel.dispatch(HumHumAction.PairingInputRejected("二维码已过期"))
        assertEquals(ConnectionStatus.CONNECTED, viewModel.state.value.connection)
        assertTrue(viewModel.state.value.canControl)
    }

    @Test
    fun rejectedNetworkSubmissionClearsRefreshPendingState() {
        viewModel.dispatch(HumHumAction.Connected(Models.Scope.READ))
        viewModel.dispatch(HumHumAction.RefreshRequested(userInitiated = true))
        assertTrue(viewModel.state.value.refreshInFlight)

        viewModel.dispatch(HumHumAction.RefreshCancelled)
        assertFalse(viewModel.state.value.refreshInFlight)
        assertEquals(ConnectionStatus.CONNECTED, viewModel.state.value.connection)
    }

    @Test
    fun visibleStatusCopyLivesInUiState() {
        viewModel.dispatch(HumHumAction.StatusChanged("远程连接 · 已处理"))
        assertEquals("远程连接 · 已处理", viewModel.state.value.statusMessage)
    }

    @Test
    fun stoppedPollingCannotInvokeRefreshLater() {
        val callbacks = AtomicInteger()
        viewModel.startPolling(100L) { callbacks.incrementAndGet() }
        viewModel.stopPolling()

        Thread.sleep(180)
        assertEquals(0, callbacks.get())
    }

    @Test
    fun repositoryUsesOneSerialNetworkLane() {
        val order = Collections.synchronizedList(mutableListOf<Int>())
        val done = CountDownLatch(2)

        repository.executeNetwork {
            order += 1
            Thread.sleep(25)
            done.countDown()
        }
        repository.executeNetwork {
            order += 2
            done.countDown()
        }

        assertTrue(done.await(2, TimeUnit.SECONDS))
        assertEquals(listOf(1, 2), order)
    }

    private fun session(id: String) = Models.Session(
        id,
        "Codex",
        "HUMHUM",
        "working",
        "now",
        true,
        true,
        true,
        listOf(Models.Action("action-1", "codex", "approve", "Allow change")),
    )
}
