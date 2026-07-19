package com.humhum.mobile.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onRoot
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.Models
import com.humhum.mobile.app.ConnectionStatus
import com.humhum.mobile.app.HealthPermission
import com.humhum.mobile.app.HealthPermissionState
import com.humhum.mobile.app.HumHumUiState
import com.humhum.mobile.health.HealthFreshness
import com.humhum.mobile.health.HealthMetric
import com.humhum.mobile.health.HealthSummary
import com.humhum.mobile.health.HealthSourceState
import com.humhum.mobile.health.HealthUiState
import java.io.File
import java.io.FileOutputStream
import java.time.Instant
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CharacterRoomsVisualQaTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun captureHumiReferenceViewport() = capture(connectedState(), "humi-first-viewport")

    @Test
    fun captureHypeReferenceViewport() = capture(
        connectedState(MobileRoleDashboard.Role.HYPE),
        "hype-first-viewport",
    )

    @Test
    fun captureHushReferenceViewport() = capture(
        connectedState(MobileRoleDashboard.Role.HUSH),
        "hush-first-viewport",
    )

    @Test
    fun captureHexaReferenceViewport() = capture(
        connectedState(MobileRoleDashboard.Role.HEXA),
        "hexa-first-viewport",
    )

    @Test
    fun capturePairingReferenceViewport() = capture(HumHumUiState(), "pairing-first-viewport")

    @Test
    fun captureSettingsReferenceViewport() = capture(
        connectedState().copy(settingsVisible = true),
        "settings-first-viewport",
    )

    @Test
    fun captureHealthUnavailableViewport() = capture(
        connectedState(MobileRoleDashboard.Role.HUSH).copy(
            health = HealthUiState(
                summary = HealthSummary(
                    steps = null,
                    restingHeartRate = null,
                    sleepMinutes = null,
                    capturedAt = null,
                    sourceStates = HealthMetric.entries.associateWith { HealthSourceState.UNAVAILABLE },
                ),
                freshness = HealthFreshness.EMPTY,
                notices = listOf("Health Connect unavailable"),
                enqueuedSignals = 0,
            ),
        ),
        "health-unavailable-viewport",
    )

    @Test
    fun captureHealthDeniedViewport() = capture(
        connectedState(MobileRoleDashboard.Role.HUSH).copy(
            healthPermissions = HealthPermissionState(),
            health = HealthUiState(
                summary = HealthSummary(
                    steps = null,
                    restingHeartRate = null,
                    sleepMinutes = null,
                    capturedAt = null,
                    sourceStates = HealthMetric.entries.associateWith { HealthSourceState.DISABLED },
                ),
                freshness = HealthFreshness.EMPTY,
                notices = emptyList(),
                enqueuedSignals = 0,
            ),
        ),
        "health-denied-viewport",
    )

    @Test
    fun captureStaleHealthViewport() = capture(
        connectedState().copy(
            health = connectedState().health?.copy(freshness = HealthFreshness.STALE),
        ),
        "health-stale-viewport",
    )

    private fun capture(state: HumHumUiState, fileName: String) {
        compose.setContent { HumHumApp(state = state, callbacks = HumHumCallbacks()) }

        compose.waitForIdle()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(context.filesDir, "qa").apply { mkdirs() }
        FileOutputStream(File(directory, "$fileName.png")).use { output ->
            compose.onRoot().captureToImage().asAndroidBitmap()
                .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output)
        }
    }

    private fun connectedState(
        selectedRole: MobileRoleDashboard.Role = MobileRoleDashboard.Role.HUMI,
    ) = HumHumUiState(
        connection = ConnectionStatus.CONNECTED,
        scope = Models.Scope.CONTROL,
        selectedRole = selectedRole,
        statusMessage = "已连接 · 本机优先",
        personalContextAuthorized = true,
        personalContext = personalContext(),
        healthPermissions = HealthPermissionState(
            granted = HealthPermission.entries.toSet(),
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
}
