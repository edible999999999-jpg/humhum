package com.humhum.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.automirrored.outlined.DirectionsWalk
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material.icons.outlined.WbSunny
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.app.HumHumUiState
import com.humhum.mobile.health.HealthFreshness
import com.humhum.mobile.ui.theme.Attention
import com.humhum.mobile.ui.theme.Humi
import com.humhum.mobile.ui.theme.HumiSoft
import com.humhum.mobile.ui.theme.Hush
import com.humhum.mobile.ui.theme.Ink
import com.humhum.mobile.ui.theme.Line
import com.humhum.mobile.ui.theme.Muted
import com.humhum.mobile.ui.components.RoleMascot
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

@Composable
fun LivingSignalsScreen(
    state: HumHumUiState,
    onAdjustToday: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val health = state.health
    val headline = when (health?.freshness) {
        HealthFreshness.STALE -> "今天的数据需要再同步一下"
        HealthFreshness.EMPTY, null -> "先从今天的一点点开始"
        HealthFreshness.FRESH -> "今天的节奏值得慢一点"
    }
    val supporting = when (health?.freshness) {
        HealthFreshness.STALE -> "身体信号有些旧了。先按自己的感受来，连接恢复后我会更新。"
        HealthFreshness.EMPTY, null -> "还没有开启身体信号。你仍然可以安静查看 Agent 进展。"
        HealthFreshness.FRESH -> "你的身体在恢复，适合稳步推进关键工作；有一个决定值得你稍作停留再选择。"
    }
    LazyColumn(
        modifier = modifier,
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            start = 20.dp,
            end = 20.dp,
            top = 10.dp,
            bottom = 22.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Text(
                text = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy年M月d日  EEEE", Locale.CHINA)),
                style = MaterialTheme.typography.bodyLarge,
                color = Ink,
                modifier = Modifier.testTag("living-signals-date"),
            )
        }
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RoleMascot(
                    role = MobileRoleDashboard.Role.HUMI,
                    contentDescription = "Humi",
                    width = 104.dp,
                    height = 124.dp,
                )
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        text = "Humi · 专注与节奏",
                        style = MaterialTheme.typography.labelLarge,
                        color = Humi,
                        modifier = Modifier
                            .background(HumiSoft, RoundedCornerShape(8.dp))
                            .padding(horizontal = 10.dp, vertical = 5.dp),
                    )
                    Text(headline, style = MaterialTheme.typography.titleLarge, color = Ink, maxLines = 2)
                    Text(supporting, style = MaterialTheme.typography.bodyMedium, color = Muted, maxLines = 2)
                    Button(
                        onClick = onAdjustToday,
                        colors = ButtonDefaults.buttonColors(containerColor = Humi),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.height(48.dp),
                    ) {
                        Icon(Icons.Outlined.Tune, contentDescription = null, modifier = Modifier.size(19.dp))
                        Spacer(Modifier.size(7.dp))
                        Text("调整今天安排", maxLines = 1)
                    }
                }
            }
        }
        item { SectionHeading("今天的路线", "三件重要的事") }
        item {
            TimelineItem(
                time = "早上\n07:30",
                icon = Icons.Outlined.FavoriteBorder,
                accent = Hush,
                title = "身体恢复",
                state = healthStateCopy(state),
                detail = healthDetail(state),
                trailing = recoveryScore(state),
            )
        }
        item {
            TimelineItem(
                time = "上午\n09:30",
                icon = Icons.Outlined.Schedule,
                accent = Color(0xFF5C91D9),
                title = "专注工作",
                state = if (state.sessions.isEmpty()) "待开始" else "进行中",
                detail = state.sessions.firstOrNull()?.project()?.takeIf { it.isNotBlank() }
                    ?: "给今天保留一段不被打断的时间",
                trailing = if (state.sessions.isEmpty()) "45 分钟" else "${state.sessions.size} 个会话",
            )
        }
        item {
            val attention = state.sessions.count { it.needsAttention() }
            TimelineItem(
                time = "下午\n16:30",
                icon = Icons.Outlined.WbSunny,
                accent = Attention,
                title = "待决选择",
                state = if (attention == 0) "很安静" else "待处理",
                detail = if (attention == 0) "目前没有需要你决定的 Agent 操作" else "$attention 件事需要你的判断",
                trailing = if (attention == 0) "保持节奏" else "中等影响",
            )
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("个人信号", style = MaterialTheme.typography.titleLarge, color = Ink)
                Text(" · 本机私密数据", style = MaterialTheme.typography.bodyMedium, color = Muted)
                Spacer(Modifier.weight(1f))
                Icon(Icons.Outlined.Lock, contentDescription = null, tint = Muted, modifier = Modifier.size(18.dp))
            }
        }
        item { PersonalSignals(state) }
    }
}

@Composable
private fun SectionHeading(title: String, trailing: String) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleLarge, color = Ink)
        Spacer(Modifier.weight(1f))
        Text(trailing, style = MaterialTheme.typography.bodyMedium, color = Muted)
    }
}

@Composable
private fun TimelineItem(
    time: String,
    icon: ImageVector,
    accent: Color,
    title: String,
    state: String,
    detail: String,
    trailing: String,
) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = time,
            style = MaterialTheme.typography.bodyMedium,
            color = Muted,
            modifier = Modifier.size(width = 54.dp, height = 40.dp),
        )
        Box(
            modifier = Modifier
                .size(44.dp)
                .background(accent.copy(alpha = 0.10f), CircleShape)
                .border(1.dp, accent.copy(alpha = 0.34f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = accent, modifier = Modifier.size(23.dp))
        }
        Spacer(Modifier.size(8.dp))
        Surface(
            modifier = Modifier.weight(1f),
            shape = RoundedCornerShape(8.dp),
            color = Color.White,
            border = androidx.compose.foundation.BorderStroke(1.dp, Line),
        ) {
            Column(modifier = Modifier.padding(horizontal = 11.dp, vertical = 9.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(title, style = MaterialTheme.typography.titleMedium, color = Ink)
                    Spacer(Modifier.size(8.dp))
                    Text(
                        state,
                        style = MaterialTheme.typography.labelMedium,
                        color = accent,
                        modifier = Modifier.background(accent.copy(alpha = 0.10f), RoundedCornerShape(8.dp))
                            .padding(horizontal = 7.dp, vertical = 3.dp),
                    )
                    Spacer(Modifier.weight(1f))
                    Text(trailing, style = MaterialTheme.typography.labelMedium, color = accent)
                }
                Text(detail, style = MaterialTheme.typography.bodyMedium, color = Muted, maxLines = 1)
            }
        }
    }
}

@Composable
private fun PersonalSignals(state: HumHumUiState) {
    val summary = state.health?.summary
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = Color.White,
        shape = RoundedCornerShape(8.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, Line),
    ) {
        Row(modifier = Modifier.padding(vertical = 14.dp)) {
            SignalMetric(
                label = "步数",
                value = summary?.steps?.roundToInt()?.let { "%,d".format(it) } ?: "--",
                unit = "步",
                icon = Icons.AutoMirrored.Outlined.DirectionsWalk,
                accent = Hush,
                modifier = Modifier.weight(1f),
            )
            SignalMetric(
                label = "静息心率",
                value = summary?.restingHeartRate?.roundToInt()?.toString() ?: "--",
                unit = "bpm",
                icon = Icons.Outlined.FavoriteBorder,
                accent = Color(0xFFF07878),
                modifier = Modifier.weight(1f),
            )
            SignalMetric(
                label = "睡眠",
                value = summary?.sleepMinutes?.let { "${(it / 60).toInt()}时${(it % 60).roundToInt()}分" } ?: "--",
                unit = "",
                icon = Icons.Outlined.Schedule,
                accent = Humi,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun SignalMetric(
    label: String,
    value: String,
    unit: String,
    icon: ImageVector,
    accent: Color,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.padding(horizontal = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(icon, contentDescription = null, tint = accent, modifier = Modifier.size(22.dp))
        Spacer(Modifier.height(4.dp))
        Text(label, style = MaterialTheme.typography.labelMedium, color = Muted, textAlign = TextAlign.Center)
        Text(value, style = MaterialTheme.typography.titleMedium, color = Ink, textAlign = TextAlign.Center, maxLines = 1)
        if (unit.isNotEmpty()) Text(unit, style = MaterialTheme.typography.labelMedium, color = Muted)
    }
}

private fun healthStateCopy(state: HumHumUiState): String = when (state.health?.freshness) {
    HealthFreshness.FRESH -> "恢复中"
    HealthFreshness.STALE -> "待更新"
    HealthFreshness.EMPTY, null -> "未开启"
}

private fun healthDetail(state: HumHumUiState): String {
    val summary = state.health?.summary ?: return "开启身体信号后，Humi 会只用日汇总理解你的节奏"
    return when {
        summary.sleepMinutes != null && summary.sleepMinutes < 420 -> "昨晚休息略少，今天适合稳一点"
        summary.restingHeartRate != null -> "静息心率平稳，适合稳步推进"
        summary.steps != null -> "今天已经开始活动，记得留一点恢复时间"
        else -> "身体信号已连接，等待今天的汇总"
    }
}

private fun recoveryScore(state: HumHumUiState): String {
    val summary = state.health?.summary ?: return "等待信号"
    val sleep = summary.sleepMinutes ?: 0.0
    val heart = summary.restingHeartRate ?: 72.0
    return (50 + (sleep / 12) - ((heart - 55).coerceAtLeast(0.0) / 2)).coerceIn(0.0, 100.0)
        .roundToInt().let { "$it 恢复分" }
}
