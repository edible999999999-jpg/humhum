package com.humhum.mobile.ui

import android.content.res.Configuration
import androidx.activity.ComponentActivity
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
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
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class HumHumAppTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun humiFirstViewportKeepsFourRoomsAndSettingsSeparate() {
        compose.setContent {
            var state by androidx.compose.runtime.remember { mutableStateOf(connectedState()) }
            HumHumApp(
                state = state,
                callbacks = HumHumCallbacks(
                    onOpenSettings = { state = state.copy(settingsVisible = true) },
                ),
            )
        }

        compose.onNodeWithTag("humi-room").assertIsDisplayed()
        compose.onNodeWithText("今天").assertIsDisplayed()
        compose.onNodeWithText("完成 Android 房间").assertIsDisplayed()
        compose.onNodeWithText("身体信号").assertIsDisplayed()
        compose.onAllNodesWithTag("role-destination", useUnmergedTree = true).assertCountEquals(4)
        compose.onNodeWithTag("settings-screen").assertDoesNotExist()

        compose.onNodeWithContentDescription("设置").performClick()
        compose.onNodeWithTag("settings-screen").assertIsDisplayed()
    }

    @Test
    fun humiOnlyRequestsHealthPermissionAfterSourceAction() {
        val requests = AtomicInteger()
        setContent(
            state = connectedState().copy(
                selectedRole = MobileRoleDashboard.Role.HUMI,
                healthPermissions = HealthPermissionState(),
            ),
            callbacks = HumHumCallbacks(onRequestHealthPermission = { requests.incrementAndGet() }),
        )

        assertEquals(0, requests.get())
        compose.onNodeWithTag("health-source-steps").performClick()
        compose.waitForIdle()
        assertEquals(1, requests.get())
    }

    @Test
    fun enabledHumiHealthSourceOpensSystemManagementInsteadOfRequestingAgain() {
        val requests = AtomicInteger()
        val management = AtomicInteger()
        setContent(
            state = connectedState().copy(selectedRole = MobileRoleDashboard.Role.HUMI),
            callbacks = HumHumCallbacks(
                onRequestHealthPermission = { requests.incrementAndGet() },
                onManageHealthPermissions = { management.incrementAndGet() },
            ),
        )

        compose.onNodeWithTag("health-source-steps").performClick()

        assertEquals(0, requests.get())
        assertEquals(1, management.get())
    }

    @Test
    fun hushShowsAuthorizedInboxAndNeverShowsHealthSources() {
        setContent(
            state = connectedState().copy(selectedRole = MobileRoleDashboard.Role.HUSH),
        )

        compose.onNodeWithTag("hush-room").assertIsDisplayed()
        compose.onNodeWithText("Peidong").assertIsDisplayed()
        compose.onNodeWithTag("health-source-steps").assertDoesNotExist()
    }

    @Test
    fun manualPairingMaterialIsRecoveryOnly() {
        setContent(state = HumHumUiState())

        compose.onNodeWithTag("manual-pairing-fields").assertDoesNotExist()
        compose.onNodeWithText("连接遇到问题").performClick()
        compose.onNodeWithTag("manual-pairing-fields").assertIsDisplayed()
    }

    @Test
    fun pairingExplainsTheActualAndroidStorageBoundary() {
        setContent(state = HumHumUiState())

        compose.onNodeWithText("Android 安全存储", substring = true).assertDoesNotExist()
        compose.onNodeWithText("Android 私有应用存储", substring = true).assertIsDisplayed()
    }

    @Test
    fun everyRoomHeaderKeepsConnectionAndSettingsInsideTheViewport() {
        var state by mutableStateOf(connectedState())
        compose.setContent {
            HumHumApp(state = state, callbacks = HumHumCallbacks())
        }

        MobileRoleDashboard.Role.entries.forEach { role ->
            compose.runOnIdle { state = state.copy(selectedRole = role) }
            val header = compose.onNodeWithTag("companion-header")
                .fetchSemanticsNode()
                .boundsInRoot
            val settings = compose.onNodeWithContentDescription("设置")
                .fetchSemanticsNode()
                .boundsInRoot

            compose.onNodeWithText("已连接", substring = true).assertIsDisplayed()
            compose.onNodeWithContentDescription("设置").assertIsDisplayed()
            assertTrue("role=$role header=$header settings=$settings", settings.right <= header.right)
        }
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
        compose.onNodeWithText("只读观察", substring = true).assertIsDisplayed()
    }

    @Test
    fun hexaKeepsFollowUpDraftUntilDeliverySucceeds() {
        val sends = AtomicInteger()
        setContent(
            state = connectedState().copy(
                selectedRole = MobileRoleDashboard.Role.HEXA,
                sessions = listOf(controllableSession()),
            ),
            callbacks = HumHumCallbacks(onSendFollowUp = { _, _ -> sends.incrementAndGet() }),
        )

        compose.onNodeWithTag("follow-up-draft").performTextInput("请继续验证")
        compose.onNodeWithContentDescription("发送").performClick()

        assertEquals(1, sends.get())
        assertEditableText("follow-up-draft", "请继续验证")
    }

    @Test
    fun hexaClearsFollowUpDraftAfterDeliverySucceeds() {
        var state by mutableStateOf(
            connectedState().copy(
                selectedRole = MobileRoleDashboard.Role.HEXA,
                sessions = listOf(controllableSession()),
            ),
        )
        compose.setContent {
            HumHumApp(state = state, callbacks = HumHumCallbacks())
        }

        compose.onNodeWithTag("follow-up-draft").performTextInput("请继续验证")
        compose.runOnIdle {
            state = state.copy(
                lastSuccessfulFollowUpSessionId = "session-1",
                followUpSuccessRevision = state.followUpSuccessRevision + 1,
            )
        }

        assertEditableText("follow-up-draft", "")
    }

    @Test
    fun primaryContentAndBottomNavigationRemainVisibleAtLargeFont() {
        setContent(state = connectedState(), fontScale = 1.3f)

        compose.onNodeWithText("完成 Android 房间").assertIsDisplayed()
        compose.onAllNodesWithTag("role-destination", useUnmergedTree = true).assertCountEquals(4)
    }

    @Test
    fun livingSignalsNeverInventARecoveryScore() {
        setContent(state = connectedState())

        compose.onNodeWithText("恢复分", substring = true).assertDoesNotExist()
    }

    @Test
    fun humiHealthCopyStatesWhatWasActuallyObserved() {
        setContent(state = connectedState())

        compose.onNodeWithText("今天的节奏值得慢一点").assertDoesNotExist()
        compose.onNodeWithText("身体信号").assertIsDisplayed()
    }

    @Test
    fun staleHealthShowsWhenTheSummaryWasCaptured() {
        setContent(
            state = connectedState().copy(
                health = connectedState().health?.copy(freshness = HealthFreshness.STALE),
            ),
        )

        compose.onNodeWithText("采集于", substring = true).assertIsDisplayed()
    }

    @Test
    fun companionContentStaysInsideSystemBars() {
        setContent(state = connectedState())

        val resources = compose.activity.resources
        val windowInsets = ViewCompat.getRootWindowInsets(compose.activity.window.decorView)
        val statusBar = windowInsets
            ?.getInsets(WindowInsetsCompat.Type.statusBars())
            ?.top
            ?: 0
        val navigationBar = windowInsets
            ?.getInsets(WindowInsetsCompat.Type.navigationBars())
            ?.bottom
            ?: 0
        val root = compose.onRoot().fetchSemanticsNode().boundsInRoot
        val header = compose.onNodeWithTag("companion-header").fetchSemanticsNode().boundsInRoot
        val navigation = compose.onNodeWithTag("role-navigation").fetchSemanticsNode().boundsInRoot
        val displayHeight = resources.displayMetrics.heightPixels.toFloat()
        val decorAlreadyFitsSystemWindows =
            root.height <= displayHeight - statusBar - navigationBar + 1f

        val evidence = "root=$root displayHeight=$displayHeight status=$statusBar nav=$navigationBar " +
            "header=$header navigation=$navigation"
        assertTrue(evidence, decorAlreadyFitsSystemWindows || header.top >= statusBar)
        assertTrue(evidence, decorAlreadyFitsSystemWindows || navigation.bottom <= root.bottom - navigationBar)
    }

    @Test
    fun personalSignalsStayAboveTheFixedRoleNavigation() {
        setContent(state = connectedState())

        val signals = compose.onNodeWithTag("personal-signals-card")
            .fetchSemanticsNode()
            .boundsInRoot
        val navigation = compose.onNodeWithTag("role-navigation")
            .fetchSemanticsNode()
            .boundsInRoot

        assertTrue("signals=$signals navigation=$navigation", signals.bottom <= navigation.top)
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
            val currentDensity = LocalDensity.current
            val configuration = Configuration(current).apply { this.fontScale = fontScale }
            androidx.compose.runtime.CompositionLocalProvider(
                LocalConfiguration provides configuration,
                LocalDensity provides Density(currentDensity.density, fontScale),
            ) {
                HumHumApp(state = state, callbacks = callbacks)
            }
        }
    }

    private fun connectedState() = HumHumUiState(
        connection = ConnectionStatus.CONNECTED,
        scope = Models.Scope.CONTROL,
        statusMessage = "已连接 · 本机优先",
        personalContextAuthorized = true,
        personalContext = personalContext(),
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

    private fun personalContext() = Models.PersonalContext(
        1,
        "2026-07-19T09:00:00Z",
        "2026-07-20T09:00:00Z",
        listOf(
            Models.TodayItem(
                "goal-1",
                "完成 Android 房间",
                "通过构建与视觉检查",
                "hexa_goal",
                "active",
            ),
        ),
        listOf(
            Models.Suggestion(
                "suggestion-1",
                "先处理需要确认的 Agent",
                "有一个会话正在等待",
                "hexa",
                "reported",
            ),
        ),
        listOf(Models.Preference("preference-1", "workflow", "先想清楚数据从哪里来")),
        emptyList(),
        listOf(Models.Memory("memory-1", "Humi 在手机上保留伴侣功能", "warm")),
        listOf(Models.KnowledgeItem("skill-1", "数据整理", "把信息变成可复用结构", "skill")),
        listOf(
            Models.InboxItem(
                "message-1",
                "Peidong",
                "DingTalk",
                "UI 已经重新推送",
                "2026-07-19T08:00:00Z",
                5,
            ),
        ),
        listOf(
            Models.AgentItem(
                "session-1",
                "Android UI",
                "Codex",
                "working",
                "同步四个角色房间",
                false,
                "2026-07-19T08:30:00Z",
            ),
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

    private fun assertEditableText(tag: String, expected: String) {
        val actual = compose.onNodeWithTag(tag)
            .fetchSemanticsNode()
            .config[SemanticsProperties.EditableText]
            .text
        assertEquals(expected, actual)
    }

}
