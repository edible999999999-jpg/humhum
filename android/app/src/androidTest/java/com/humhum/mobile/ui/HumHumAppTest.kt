package com.humhum.mobile.ui

import android.content.res.Configuration
import androidx.activity.ComponentActivity
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.humhum.mobile.MainActivity
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.Models
import com.humhum.mobile.app.ConnectionStatus
import com.humhum.mobile.app.HealthPermission
import com.humhum.mobile.app.HealthPermissionState
import com.humhum.mobile.app.HumHumUiState
import com.humhum.mobile.health.HealthFreshness
import com.humhum.mobile.health.HealthSummary
import com.humhum.mobile.health.HealthUiState
import java.time.Instant
import java.util.concurrent.atomic.AtomicInteger
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class HumHumAppTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun livingSignalsFirstViewportKeepsFourRolesAndSettingsSeparate() {
        compose.setContent {
            var state by androidx.compose.runtime.remember { mutableStateOf(connectedState()) }
            HumHumApp(
                state = state,
                callbacks = HumHumCallbacks(
                    onOpenSettings = { state = state.copy(settingsVisible = true) },
                ),
            )
        }

        compose.onNodeWithTag("living-signals-date").assertIsDisplayed()
        compose.onNodeWithText("今天的节奏值得慢一点").assertIsDisplayed()
        compose.onNodeWithText("今天的路线").assertIsDisplayed()
        compose.onNodeWithText("本机私密数据", substring = true).assertIsDisplayed()
        compose.onAllNodesWithTag("role-destination", useUnmergedTree = true).assertCountEquals(4)
        compose.onNodeWithTag("settings-screen").assertDoesNotExist()

        compose.onNodeWithContentDescription("设置").performClick()
        compose.onNodeWithTag("settings-screen").assertIsDisplayed()
    }

    @Test
    fun hushOnlyRequestsHealthPermissionAfterSourceAction() {
        val requests = AtomicInteger()
        setContent(
            state = connectedState().copy(selectedRole = MobileRoleDashboard.Role.HUSH),
            callbacks = HumHumCallbacks(onRequestHealthPermission = { requests.incrementAndGet() }),
        )

        assertEquals(0, requests.get())
        compose.onNodeWithTag("health-source-steps").performClick()
        compose.waitForIdle()
        assertEquals(1, requests.get())
    }

    @Test
    fun manualPairingMaterialIsRecoveryOnly() {
        setContent(state = HumHumUiState())

        compose.onNodeWithTag("manual-pairing-fields").assertDoesNotExist()
        compose.onNodeWithText("连接遇到问题").performClick()
        compose.onNodeWithTag("manual-pairing-fields").assertIsDisplayed()
    }

    @Test
    fun hexaReadScopeNeverShowsApprovalOrFollowUpControls() {
        setContent(
            state = connectedState().copy(
                scope = Models.Scope.READ,
                selectedRole = MobileRoleDashboard.Role.HEXA,
                sessions = listOf(controllableSession()),
            ),
        )

        compose.onNodeWithText("允许").assertDoesNotExist()
        compose.onNodeWithText("发送").assertDoesNotExist()
        compose.onNodeWithText("只读观察").assertIsDisplayed()
    }

    @Test
    fun primaryActionsAndBottomNavigationRemainVisibleAtLargeFont() {
        setContent(state = connectedState(), fontScale = 1.3f)

        compose.onNodeWithText("调整今天安排").assertIsDisplayed()
        compose.onAllNodesWithTag("role-destination", useUnmergedTree = true).assertCountEquals(4)
    }

    @Test
    fun activityCanRecreateAndCloseWithoutLateRefreshCrash() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.recreate()
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.DESTROYED)
        }
    }

    private fun setContent(
        state: HumHumUiState,
        callbacks: HumHumCallbacks = HumHumCallbacks(),
        fontScale: Float = 1f,
    ) {
        compose.setContent {
            val current = LocalConfiguration.current
            val configuration = Configuration(current).apply { this.fontScale = fontScale }
            androidx.compose.runtime.CompositionLocalProvider(LocalConfiguration provides configuration) {
                HumHumApp(state = state, callbacks = callbacks)
            }
        }
    }

    private fun connectedState() = HumHumUiState(
        connection = ConnectionStatus.CONNECTED,
        scope = Models.Scope.CONTROL,
        statusMessage = "已连接 · 本机优先",
        healthPermissions = HealthPermissionState(
            granted = setOf(
                HealthPermission.STEPS,
                HealthPermission.RESTING_HEART_RATE,
                HealthPermission.SLEEP,
            ),
        ),
        health = HealthUiState(
            summary = HealthSummary(
                steps = 6_342.0,
                restingHeartRate = 58.0,
                sleepMinutes = 432.0,
                capturedAt = Instant.now(),
                sourceStates = emptyMap(),
            ),
            freshness = HealthFreshness.FRESH,
            notices = emptyList(),
            enqueuedSignals = 0,
        ),
    )

    private fun controllableSession() = Models.Session(
        "session-1",
        "Codex",
        "HUMHUM",
        "working",
        "now",
        true,
        true,
        true,
        listOf(Models.Action("action-1", "Codex", "Run command", "需要确认")),
    )

}
