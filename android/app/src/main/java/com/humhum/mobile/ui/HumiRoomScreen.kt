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
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.dp
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.R
import com.humhum.mobile.app.HealthPermission
import com.humhum.mobile.app.HumHumUiState
import com.humhum.mobile.app.resolve
import com.humhum.mobile.health.HealthMetric
import com.humhum.mobile.health.HealthFreshness
import com.humhum.mobile.health.HealthSourceState
import com.humhum.mobile.ui.theme.Humi
import com.humhum.mobile.ui.theme.HumiSoft
import com.humhum.mobile.ui.theme.Hush
import com.humhum.mobile.ui.theme.HushSoft
import com.humhum.mobile.ui.theme.HumHumMono
import com.humhum.mobile.ui.theme.HumHumSerif
import com.humhum.mobile.ui.theme.Ink
import com.humhum.mobile.ui.theme.Line
import com.humhum.mobile.ui.theme.Muted
import com.humhum.mobile.ui.theme.EditorialFocus
import com.humhum.mobile.ui.theme.EditorialHero
import com.humhum.mobile.ui.theme.EditorialMetrics
import com.humhum.mobile.ui.theme.EditorialOnFocus
import com.humhum.mobile.ui.theme.EditorialSection
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
            start = EditorialMetrics.HorizontalPadding,
            end = EditorialMetrics.HorizontalPadding,
            top = EditorialMetrics.ContentTopPadding,
            bottom = EditorialMetrics.ContentBottomPadding,
        ),
        verticalArrangement = Arrangement.spacedBy(20.dp),
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
                    Text(stringResource(R.string.humi_hero_title), style = EditorialHero, color = Ink)
                    Text(
                        stringResource(R.string.humi_hero_detail),
                        style = MaterialTheme.typography.bodyMedium,
                        color = Muted,
                    )
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        issueNumber(),
                        style = MaterialTheme.typography.displaySmall.copy(
                            fontFamily = HumHumSerif,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 52.sp,
                            lineHeight = 43.sp,
                        ),
                        color = Humi.copy(alpha = 0.24f),
                    )
                    Text(
                        editorialSpecFor(MobileRoleDashboard.Role.HUMI).indexLabel,
                        style = MaterialTheme.typography.labelMedium.copy(
                            fontFamily = HumHumMono,
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
                    state.personalContextMessage?.resolve(),
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
                    stringResource(R.string.humi_section_today),
                    trailing = context?.today()?.size?.let { stringResource(R.string.humi_today_trailing, it) },
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
                        stringResource(R.string.humi_nothing_to_interrupt),
                        style = MaterialTheme.typography.bodyMedium,
                        color = Muted,
                        modifier = Modifier.padding(vertical = 12.dp),
                    )
                }
            }
        }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                RoomSectionHeader(stringResource(R.string.humi_section_body_signals), trailing = healthSectionTrailing(state))
                HealthSummaryStrip(state)
            }
        }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                RoomSectionHeader(
                    stringResource(R.string.humi_section_memory),
                    trailing = if (state.personalContextFromCache) stringResource(R.string.humi_memory_cache) else null,
                )
                val memory = context?.memories()?.firstOrNull()
                val habit = context?.habits()?.firstOrNull()
                when {
                    memory != null -> RoomItem(
                        memory.content(),
                        stringResource(R.string.humi_memory_confirmed, memory.temperature()),
                        Humi,
                    )
                    habit != null -> RoomItem(
                        habit.title(),
                        "${habit.cadence()} · ${habit.status()}",
                        Humi,
                    )
                    else -> ContextUnavailable(
                        state.personalContextAuthorized,
                        stringResource(R.string.humi_memory_placeholder),
                    )
                }
            }
        }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                RoomSectionHeader(stringResource(R.string.humi_section_health_sources), trailing = stringResource(R.string.humi_on_demand))
                Text(stringResource(R.string.humi_data_source), style = MaterialTheme.typography.labelLarge, color = Muted)
                HealthSourceRow(
                    icon = Icons.AutoMirrored.Outlined.DirectionsWalk,
                    title = stringResource(R.string.humi_metric_steps),
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
                    title = stringResource(R.string.humi_metric_resting_heart_rate),
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
                    title = stringResource(R.string.humi_metric_sleep),
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
                    .padding(start = 17.dp, top = 15.dp, end = 15.dp, bottom = 15.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(stringResource(R.string.humi_focus_noticed, status), style = MaterialTheme.typography.labelMedium, color = HumiSoft)
                Text(title, style = EditorialSection, color = EditorialOnFocus)
                Text(detail, style = MaterialTheme.typography.bodyMedium, color = Color(0xFFC8CBC7))
                Text(
                    stringResource(R.string.humi_continue_focus),
                    style = MaterialTheme.typography.labelLarge,
                    color = EditorialOnFocus,
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
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 63.dp)
            .padding(vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(11.dp),
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
                stringResource(R.string.humi_metric_steps),
                summary?.steps?.roundToInt()?.let { "%,d".format(it) } ?: "--",
                Hush,
                Modifier.weight(1f),
            )
            HealthMetricValue(
                stringResource(R.string.humi_metric_resting_heart_rate),
                summary?.restingHeartRate?.roundToInt()?.let { "$it bpm" } ?: "--",
                Color(0xFFD85C67),
                Modifier.weight(1f),
            )
            HealthMetricValue(
                stringResource(R.string.humi_metric_sleep),
                summary?.sleepMinutes?.let {
                    // Round to whole minutes first, then split, so a minute
                    // remainder rounding up to 60 carries into the hour instead
                    // of rendering e.g. "7时60分".
                    val totalMinutes = it.roundToInt()
                    stringResource(R.string.humi_sleep_duration, totalMinutes / 60, totalMinutes % 60)
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
            if (enabled) stringResource(R.string.humi_source_permission) else stringResource(R.string.humi_source_enable),
            style = MaterialTheme.typography.labelMedium,
            color = if (enabled) Hush else Humi,
        )
    }
}

@Composable
private fun healthSummary(state: HumHumUiState): String {
    val summary = state.health?.summary ?: return stringResource(R.string.humi_health_not_enabled)
    val count = listOf(
        summary.steps,
        summary.restingHeartRate,
        summary.sleepMinutes,
    ).count { it != null }
    return if (count == 0) {
        stringResource(R.string.humi_health_waiting_data)
    } else {
        stringResource(R.string.humi_health_daily_summary_count, count)
    }
}

private fun issueNumber(): String = LocalDate.now().format(DateTimeFormatter.ofPattern("MM"))

@Composable
private fun healthSectionTrailing(state: HumHumUiState): String {
    val captured = state.health?.summary?.capturedAt
    if (state.health?.freshness == HealthFreshness.STALE && captured != null) {
        val formatted = captured.atZone(ZoneId.systemDefault()).format(
            DateTimeFormatter.ofPattern("M/d HH:mm", Locale.getDefault())
        )
        return stringResource(R.string.humi_health_captured_at, formatted)
    }
    return healthSummary(state)
}

@Composable
private fun healthSourceDetail(
    state: HumHumUiState,
    permission: HealthPermission,
    metric: HealthMetric,
): String {
    if (permission !in state.healthPermissions.granted) return stringResource(R.string.humi_source_ask_android)
    return when (state.health?.summary?.sourceStates?.get(metric)) {
        HealthSourceState.HEALTH_CONNECT -> stringResource(R.string.humi_source_health_connect)
        HealthSourceState.PHONE_STEP_COUNTER -> stringResource(R.string.humi_source_phone_counter)
        HealthSourceState.UNAVAILABLE -> stringResource(R.string.humi_source_device_unavailable)
        HealthSourceState.DISABLED, null -> stringResource(R.string.humi_source_allowed_waiting)
    }
}

@Composable
private fun sourceLabel(source: String): String = when (source) {
    "hexa_goal" -> stringResource(R.string.humi_source_from_hexa_goal)
    "obsidian_task" -> stringResource(R.string.humi_source_from_note_task)
    else -> stringResource(R.string.humi_source_from_confirmed)
}

@Composable
private fun statusLabel(status: String): String = when (status) {
    "waiting" -> stringResource(R.string.humi_status_waiting)
    "completed" -> stringResource(R.string.humi_status_completed)
    else -> stringResource(R.string.humi_status_in_progress)
}

private fun todayLabel(): String = LocalDate.now().format(
    DateTimeFormatter.ofPattern("MMMM d · EEEE", Locale.getDefault()),
)
