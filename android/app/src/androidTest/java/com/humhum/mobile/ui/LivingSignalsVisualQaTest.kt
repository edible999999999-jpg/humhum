package com.humhum.mobile.ui

import android.content.ContentValues
import android.os.Build
import android.provider.MediaStore
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.core.view.drawToBitmap
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
class LivingSignalsVisualQaTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun captureHumiReferenceViewport() = capture(connectedState(), "living-signals-first-viewport")

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
        val screenshot = File(directory, "$fileName.png")
        var bitmap: android.graphics.Bitmap? = null
        compose.runOnIdle {
            bitmap = compose.activity.window.decorView.drawToBitmap()
        }
        FileOutputStream(screenshot).use { output ->
            checkNotNull(bitmap).compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val resolver = context.contentResolver
            val collection = MediaStore.Images.Media.getContentUri(
                MediaStore.VOLUME_EXTERNAL_PRIMARY,
            )
            val relativePath = "Pictures/HUMHUM-QA"
            resolver.delete(
                collection,
                "${MediaStore.Images.Media.DISPLAY_NAME} = ?",
                arrayOf("$fileName.png"),
            )
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, "$fileName.png")
                put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                put(MediaStore.Images.Media.RELATIVE_PATH, relativePath)
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }
            val uri = checkNotNull(resolver.insert(collection, values))
            resolver.openOutputStream(uri).use { output ->
                checkNotNull(output)
                checkNotNull(bitmap).compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output)
            }
            values.clear()
            values.put(MediaStore.Images.Media.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
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
        sessions = listOf(
            Models.Session(
                "session-1",
                "Codex",
                "HUMHUM Android UI",
                "working",
                "刚刚",
                true,
                true,
                true,
                emptyList(),
            ),
        ),
    )

    private fun personalContext() = Models.PersonalContext(
        1,
        "2026-07-19T09:00:00Z",
        "2026-07-20T09:00:00Z",
        listOf(
            Models.TodayItem(
                "goal-1",
                "移动端的体验，正在真正成形",
                "四个角色已经各自清晰，下一步只需要让字体和节奏更像你。",
                "hexa_goal",
                "active",
            ),
            Models.TodayItem(
                "goal-2",
                "验证 Android 新版设计",
                "来自 Hexa 目标 · 今天",
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
            Models.InboxItem(
                "message-2",
                "妈妈",
                "WeChat",
                "晚上回来吃饭吗？我准备早点做饭。",
                "2026-07-19T07:37:00Z",
                5,
            ),
            Models.InboxItem(
                "message-3",
                "悦湖府吃货团购群",
                "WeChat",
                "今天下午的水果团购截止到三点，需要的接龙。",
                "2026-07-19T07:22:00Z",
                3,
            ),
            Models.InboxItem(
                "message-4",
                "HUMHUM 项目群",
                "WeChat",
                "Release 里的 Mac 和 Android 资产已经并列显示。",
                "2026-07-18T12:10:00Z",
                4,
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
