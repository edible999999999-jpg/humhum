package com.humhum.mobile.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.automirrored.outlined.DirectionsWalk
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.app.HealthPermission
import com.humhum.mobile.app.HumHumUiState
import com.humhum.mobile.health.HealthMetric
import com.humhum.mobile.health.HealthFreshness
import com.humhum.mobile.health.HealthSourceState
import com.humhum.mobile.ui.components.RolePoster
import com.humhum.mobile.ui.theme.Humi
import com.humhum.mobile.ui.theme.Hush
import com.humhum.mobile.ui.theme.HeadlineNumberStyle
import com.humhum.mobile.ui.theme.Ink
import com.humhum.mobile.ui.theme.Line
import com.humhum.mobile.ui.theme.Muted
import kotlin.math.roundToInt
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
fun HumiRoomScreen(
    state: HumHumUiState,
    callbacks: HumHumCallbacks,
    modifier: Modifier = Modifier,
) {
    val context = state.personalContext
    var draft by rememberSaveable { mutableStateOf("") }
    var composerNotice by rememberSaveable { mutableStateOf(false) }
    val intro = context?.today()?.firstOrNull()?.let {
        "我先替你看住“${it.title()}”，其他事情可以慢一点来。"
    } ?: "我会把今天、身体信号和真正值得记住的事放在一起。"
    LazyColumn(
        modifier = modifier.testTag("humi-room"),
        contentPadding = PaddingValues(bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            RolePoster(MobileRoleDashboard.Role.HUMI)
        }
        item {
            Column(
                modifier = Modifier
                    .padding(horizontal = 20.dp)
                    .testTag("humi-primary-judgment"),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text("Humi 注意到", style = MaterialTheme.typography.labelLarge, color = Humi)
                Text(
                    text = intro,
                    style = MaterialTheme.typography.headlineMedium,
                    color = Ink,
                    maxLines = 2,
                )
                Text(
                    text = when {
                        context == null -> "等待 Mac 的已授权个人上下文"
                        context.today().isEmpty() -> "今天暂无明确条目 · ${if (state.personalContextFromCache) "加密缓存" else "刚刚同步"}"
                        else -> "来自已确认的今天 · ${if (state.personalContextFromCache) "加密缓存" else "刚刚同步"}"
                    },
                    style = MaterialTheme.typography.labelMedium,
                    color = Muted,
                )
            }
        }
        item {
            Column(
                modifier = Modifier
                    .padding(horizontal = 20.dp)
                    .fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                if (composerNotice) {
                    Text(
                        "尚未发送：手机版 Humi 对话通道还没有接入，草稿已为你保留。",
                        style = MaterialTheme.typography.labelMedium,
                        color = Muted,
                    )
                }
                OutlinedTextField(
                    value = draft,
                    onValueChange = {
                        draft = it.take(1000)
                        composerNotice = false
                    },
                    placeholder = { Text("和 Humi 聊聊") },
                    leadingIcon = {
                        Icon(Icons.Outlined.Mic, contentDescription = "语音输入")
                    },
                    trailingIcon = {
                        IconButton(
                            onClick = { composerNotice = true },
                            enabled = draft.isNotBlank(),
                        ) {
                            Icon(
                                Icons.AutoMirrored.Outlined.Send,
                                contentDescription = "发送给 Humi",
                            )
                        }
                    },
                    singleLine = true,
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("humi-composer"),
                )
            }
        }
        item {
            Column(
                modifier = Modifier
                    .padding(horizontal = 20.dp)
                    .testTag("today-section"),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                RoomSectionHeader(
                    title = "今天",
                    trailing = context?.today()?.size?.let { "$it 件" },
                )
                if (context?.today().isNullOrEmpty()) {
                    ContextUnavailable(
                        state.personalContextAuthorized,
                        state.personalContextMessage,
                    )
                } else {
                    context!!.today().forEach { item ->
                        RoomItem(
                            title = item.title(),
                            detail = item.detail() ?: sourceLabel(item.source()),
                            accent = Humi,
                            meta = statusLabel(item.status()),
                        )
                    }
                }
            }
        }
        if (!context?.suggestions().isNullOrEmpty()) {
            item {
                Column(
                    modifier = Modifier.padding(horizontal = 20.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    RoomSectionHeader("Humi 的建议", "建议，不是事实")
                    context!!.suggestions().forEach { suggestion ->
                        RoomItem(
                            title = suggestion.title(),
                            detail = suggestion.rationale(),
                            accent = Color(0xFF4F8BC9),
                            meta = "可选择",
                        )
                    }
                }
            }
        }
        item {
            Column(
                modifier = Modifier.padding(horizontal = 20.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                RoomSectionHeader(
                    "我记得的你",
                    if (state.personalContextFromCache) "加密缓存" else null,
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
            Column(
                modifier = Modifier.padding(horizontal = 20.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                RoomSectionHeader("身体信号", healthSectionTrailing(state))
                HealthSummaryStrip(state)
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
private fun HealthSummaryStrip(state: HumHumUiState) {
    val summary = state.health?.summary
    Surface(
        modifier = Modifier.fillMaxWidth().testTag("personal-signals-card"),
        shape = RoundedCornerShape(8.dp),
        color = Color.White,
        border = BorderStroke(1.dp, Line),
    ) {
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
        Text(value, style = HeadlineNumberStyle, color = accent, maxLines = 1)
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
