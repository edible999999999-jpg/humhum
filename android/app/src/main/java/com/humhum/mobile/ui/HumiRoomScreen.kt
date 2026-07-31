package com.humhum.mobile.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.DirectionsWalk
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.CheckCircleOutline
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.Icon
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.dp
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.app.HealthPermission
import com.humhum.mobile.app.HumHumUiState
import com.humhum.mobile.health.HealthMetric
import com.humhum.mobile.health.HealthFreshness
import com.humhum.mobile.health.HealthSourceState
import com.humhum.mobile.ui.theme.Humi
import com.humhum.mobile.ui.theme.HumiSoft
import com.humhum.mobile.ui.theme.Hush
import com.humhum.mobile.ui.theme.HushSoft
import com.humhum.mobile.ui.theme.Ink
import com.humhum.mobile.ui.theme.Line
import com.humhum.mobile.ui.theme.Muted
import com.humhum.mobile.ui.theme.EditorialFocus
import com.humhum.mobile.ui.theme.EditorialHero
import com.humhum.mobile.ui.theme.EditorialOnFocus
import com.humhum.mobile.ui.theme.editorialSpecFor
import kotlin.math.roundToInt
import java.time.ZoneId
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable
fun HumiRoomScreen(
    state: HumHumUiState,
    callbacks: HumHumCallbacks,
    modifier: Modifier = Modifier,
) {
    val context = state.personalContext
    val primary = context?.today()?.firstOrNull()
    LazyColumn(
        modifier = modifier.testTag("humi-room"),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            start = 16.dp,
            end = 16.dp,
            top = 14.dp,
            bottom = 20.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    Text(todayLabel(), style = MaterialTheme.typography.labelLarge, color = Muted)
                    Text("先把最重要的事推进", style = EditorialHero, color = Ink)
                    Text(
                        "我把 Agent 进展和身体信号放在一起，只提醒真正值得你注意的部分。",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Muted,
                    )
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        issueNumber(),
                        style = MaterialTheme.typography.displaySmall.copy(
                            fontFamily = FontFamily.Serif,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 46.sp,
                            lineHeight = 46.sp,
                        ),
                        color = Humi.copy(alpha = 0.24f),
                    )
                    Text(
                        editorialSpecFor(MobileRoleDashboard.Role.HUMI).indexLabel,
                        style = MaterialTheme.typography.labelMedium.copy(
                            fontFamily = FontFamily.Monospace,
                            fontSize = 8.sp,
                        ),
                        color = Humi,
                    )
                }
            }
        }
        item {
            if (primary == null) {
                ContextUnavailable(
                    state.personalContextAuthorized,
                    state.personalContextMessage,
                )
            } else {
                FocusCard(
                    title = primary.title(),
                    detail = primary.detail() ?: sourceLabel(primary.source()),
                    status = statusLabel(primary.status()),
                )
            }
        }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                RoomSectionHeader(
                    "今天",
                    trailing = context?.today()?.size?.let { "$it 件值得注意" },
                )
                context?.today().orEmpty().drop(1).take(1).forEach { item ->
                    HumiSignalRow(
                        icon = Icons.Outlined.CheckCircleOutline,
                        title = item.title(),
                        detail = item.detail() ?: sourceLabel(item.source()),
                        accent = Humi,
                    )
                }
                context?.suggestions().orEmpty().take(1).forEach { suggestion ->
                    HumiSignalRow(
                        icon = Icons.Outlined.ChatBubbleOutline,
                        title = suggestion.title(),
                        detail = suggestion.rationale(),
                        accent = Hush,
                    )
                }
                if (context?.today().isNullOrEmpty() && context?.suggestions().isNullOrEmpty()) {
                    Text(
                        "现在没有需要打断你的事情。",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Muted,
                        modifier = Modifier.padding(vertical = 12.dp),
                    )
                }
            }
        }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                RoomSectionHeader("身体信号", trailing = healthSectionTrailing(state))
                HealthSummaryStrip(state)
            }
        }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                RoomSectionHeader(
                    "我记得的你",
                    trailing = if (state.personalContextFromCache) "加密缓存" else null,
                )
                val memory = context?.memories()?.firstOrNull()
                val habit = context?.habits()?.firstOrNull()
                when {
                    memory != null -> RoomItem(
                        memory.content(),
                        "已确认记忆 · ${memory.temperature()}",
                        Humi,
                    )
                    habit != null -> RoomItem(
                        habit.title(),
                        "${habit.cadence()} · ${habit.status()}",
                        Humi,
                    )
                    else -> ContextUnavailable(
                        state.personalContextAuthorized,
                        "这里只放已确认的记忆与习惯，不会把推测写成事实。",
                    )
                }
            }
        }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                RoomSectionHeader("健康数据来源", trailing = "按需授权")
                Text("数据来源", style = MaterialTheme.typography.labelLarge, color = Muted)
                HealthSourceRow(
                    icon = Icons.AutoMirrored.Outlined.DirectionsWalk,
                    title = "步数",
                    detail = healthSourceDetail(state, HealthPermission.STEPS, HealthMetric.STEPS),
                    enabled = HealthPermission.STEPS in state.healthPermissions.granted,
                    tag = "health-source-steps",
                    onClick = {
                        if (HealthPermission.STEPS in state.healthPermissions.granted) {
                            callbacks.onManageHealthPermissions()
                        } else {
                            callbacks.onRequestHealthPermission(HealthPermission.STEPS)
                        }
                    },
                )
                HealthSourceRow(
                    icon = Icons.Outlined.FavoriteBorder,
                    title = "静息心率",
                    detail = healthSourceDetail(
                        state,
                        HealthPermission.RESTING_HEART_RATE,
                        HealthMetric.RESTING_HEART_RATE,
                    ),
                    enabled = HealthPermission.RESTING_HEART_RATE in state.healthPermissions.granted,
                    tag = "health-source-heart",
                    onClick = {
                        if (HealthPermission.RESTING_HEART_RATE in state.healthPermissions.granted) {
                            callbacks.onManageHealthPermissions()
                        } else {
                            callbacks.onRequestHealthPermission(HealthPermission.RESTING_HEART_RATE)
                        }
                    },
                )
                HealthSourceRow(
                    icon = Icons.Outlined.Schedule,
                    title = "睡眠",
                    detail = healthSourceDetail(state, HealthPermission.SLEEP, HealthMetric.SLEEP),
                    enabled = HealthPermission.SLEEP in state.healthPermissions.granted,
                    tag = "health-source-sleep",
                    onClick = {
                        if (HealthPermission.SLEEP in state.healthPermissions.granted) {
                            callbacks.onManageHealthPermissions()
                        } else {
                            callbacks.onRequestHealthPermission(HealthPermission.SLEEP)
                        }
                    },
                )
            }
        }
    }
}

@Composable
private fun FocusCard(
    title: String,
    detail: String,
    status: String,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        color = EditorialFocus,
        border = BorderStroke(1.dp, Humi.copy(alpha = 0.45f)),
    ) {
        Row(modifier = Modifier.height(IntrinsicSize.Min)) {
            Spacer(
                Modifier
                    .width(3.dp)
                    .fillMaxHeight()
                    .background(Humi),
            )
            Column(
                modifier = Modifier.weight(1f)
                    .padding(start = 17.dp, top = 16.dp, end = 16.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("Humi 注意到 · $status", style = MaterialTheme.typography.labelMedium, color = HumiSoft)
                Text(title, style = MaterialTheme.typography.titleLarge, color = EditorialOnFocus)
                Text(detail, style = MaterialTheme.typography.bodyMedium, color = Color(0xFFC8CBC7))
                LinearProgressIndicator(
                    progress = { 0.68f },
                    modifier = Modifier.fillMaxWidth(),
                    color = Humi,
                    trackColor = Color(0xFF343735),
                )
            }
        }
    }
}

@Composable
private fun HumiSignalRow(
    icon: ImageVector,
    title: String,
    detail: String,
    accent: Color,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Surface(
            modifier = Modifier.size(36.dp),
            color = if (accent == Humi) HumiSoft else HushSoft,
            shape = RoundedCornerShape(8.dp),
        ) {
            androidx.compose.foundation.layout.Box(contentAlignment = Alignment.Center) {
                Icon(icon, contentDescription = null, modifier = Modifier.size(21.dp), tint = accent)
            }
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = Ink, maxLines = 1)
            Text(detail, style = MaterialTheme.typography.bodyMedium, color = Muted, maxLines = 1)
        }
    }
}

@Composable
private fun HealthSummaryStrip(state: HumHumUiState) {
    val summary = state.health?.summary
    Column(modifier = Modifier.fillMaxWidth().testTag("personal-signals-card")) {
        HorizontalDivider(color = Line)
        Row(modifier = Modifier.padding(vertical = 11.dp)) {
            HealthMetricValue(
                "步数",
                summary?.steps?.roundToInt()?.let { "%,d".format(it) } ?: "--",
                Hush,
                Modifier.weight(1f),
            )
            HealthMetricValue(
                "静息心率",
                summary?.restingHeartRate?.roundToInt()?.let { "$it bpm" } ?: "--",
                Color(0xFFD85C67),
                Modifier.weight(1f),
            )
            HealthMetricValue(
                "睡眠",
                summary?.sleepMinutes?.let {
                    "${(it / 60).toInt()}时${(it % 60).roundToInt()}分"
                } ?: "--",
                Humi,
                Modifier.weight(1f),
            )
        }
        HorizontalDivider(color = Line)
    }
}

@Composable
private fun HealthMetricValue(
    label: String,
    value: String,
    accent: Color,
    modifier: Modifier,
) {
    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = Muted)
        Text(value, style = MaterialTheme.typography.titleMedium, color = accent, maxLines = 1)
    }
}

@Composable
private fun HealthSourceRow(
    icon: ImageVector,
    title: String,
    detail: String,
    enabled: Boolean,
    tag: String,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .testTag(tag)
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, contentDescription = null, tint = if (enabled) Hush else Muted)
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = Ink)
            Text(detail, style = MaterialTheme.typography.bodyMedium, color = Muted)
        }
        Text(
            if (enabled) "已允许" else "开启",
            style = MaterialTheme.typography.labelMedium,
            color = if (enabled) Hush else Humi,
        )
    }
}

private fun healthSummary(state: HumHumUiState): String {
    val summary = state.health?.summary ?: return "未开启"
    val count = listOf(
        summary.steps,
        summary.restingHeartRate,
        summary.sleepMinutes,
    ).count { it != null }
    return if (count == 0) "等待数据" else "$count 项日汇总"
}

private fun issueNumber(): String = LocalDate.now().format(DateTimeFormatter.ofPattern("MM"))

private fun healthSectionTrailing(state: HumHumUiState): String {
    val captured = state.health?.summary?.capturedAt
    if (state.health?.freshness == HealthFreshness.STALE && captured != null) {
        return "采集于 ${captured.atZone(ZoneId.systemDefault()).format(
            DateTimeFormatter.ofPattern("M月d日 HH:mm")
        )}"
    }
    return healthSummary(state)
}

private fun healthSourceDetail(
    state: HumHumUiState,
    permission: HealthPermission,
    metric: HealthMetric,
): String {
    if (permission !in state.healthPermissions.granted) return "由 Android 系统询问权限"
    return when (state.health?.summary?.sourceStates?.get(metric)) {
        HealthSourceState.HEALTH_CONNECT -> "健康连接 · 只读取日汇总"
        HealthSourceState.PHONE_STEP_COUNTER -> "本机计步器"
        HealthSourceState.UNAVAILABLE -> "当前设备暂不可用"
        HealthSourceState.DISABLED, null -> "已允许，等待同步"
    }
}

private fun sourceLabel(source: String): String = when (source) {
    "hexa_goal" -> "来自 Hexa 目标"
    "obsidian_task" -> "来自你选中的笔记任务"
    else -> "来自已确认信息"
}

private fun statusLabel(status: String): String = when (status) {
    "waiting" -> "等待"
    "completed" -> "完成"
    else -> "进行中"
}

private fun todayLabel(): String = LocalDate.now().format(
    DateTimeFormatter.ofPattern("M 月 d 日 · EEEE", Locale.SIMPLIFIED_CHINESE),
)
