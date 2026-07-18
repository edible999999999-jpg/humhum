package com.humhum.mobile.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.automirrored.outlined.DirectionsWalk
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Schedule
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
import androidx.compose.ui.unit.dp
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.app.HealthPermission
import com.humhum.mobile.app.HumHumUiState
import com.humhum.mobile.health.HealthMetric
import com.humhum.mobile.health.HealthSourceState
import com.humhum.mobile.ui.theme.Hush
import com.humhum.mobile.ui.theme.HushSoft
import com.humhum.mobile.ui.theme.Ink
import com.humhum.mobile.ui.theme.Line
import com.humhum.mobile.ui.theme.Muted
import com.humhum.mobile.ui.components.RoleMascot

@Composable
fun HushSourcesScreen(
    state: HumHumUiState,
    onRequestPermission: (HealthPermission) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                RoleMascot(
                    role = MobileRoleDashboard.Role.HUSH,
                    contentDescription = "Hush",
                    width = 104.dp,
                    height = 124.dp,
                )
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Text("Hush · 私密数据", style = MaterialTheme.typography.labelLarge, color = Hush)
                    Text("只把你允许的日汇总，安全送回自己的 Mac", style = MaterialTheme.typography.headlineMedium, color = Ink)
                }
            }
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Lock, contentDescription = null, tint = Hush, modifier = Modifier.size(19.dp))
                Spacer(Modifier.size(7.dp))
                Text("数据来源", style = MaterialTheme.typography.titleLarge, color = Ink)
            }
        }
        item {
            SourceRow(
                icon = Icons.AutoMirrored.Outlined.DirectionsWalk,
                title = "每日步数",
                detail = sourceDetail(state, HealthPermission.STEPS, HealthMetric.STEPS),
                enabled = HealthPermission.STEPS in state.healthPermissions.granted,
                testTag = "health-source-steps",
                onClick = { onRequestPermission(HealthPermission.STEPS) },
            )
        }
        item {
            SourceRow(
                icon = Icons.Outlined.FavoriteBorder,
                title = "静息心率",
                detail = sourceDetail(state, HealthPermission.RESTING_HEART_RATE, HealthMetric.RESTING_HEART_RATE),
                enabled = HealthPermission.RESTING_HEART_RATE in state.healthPermissions.granted,
                testTag = "health-source-heart",
                onClick = { onRequestPermission(HealthPermission.RESTING_HEART_RATE) },
            )
        }
        item {
            SourceRow(
                icon = Icons.Outlined.Schedule,
                title = "睡眠时长",
                detail = sourceDetail(state, HealthPermission.SLEEP, HealthMetric.SLEEP),
                enabled = HealthPermission.SLEEP in state.healthPermissions.granted,
                testTag = "health-source-sleep",
                onClick = { onRequestPermission(HealthPermission.SLEEP) },
            )
        }
        item {
            Text(
                "HUMHUM 不读取原始心率样本、睡眠阶段、路线、位置或医疗记录。手机只保留最多 7 天的加密待传队列，长期记录在你的 Mac 上。",
                style = MaterialTheme.typography.bodyMedium,
                color = Muted,
                modifier = Modifier.padding(top = 6.dp),
            )
        }
    }
}

@Composable
private fun SourceRow(
    icon: ImageVector,
    title: String,
    detail: String,
    enabled: Boolean,
    testTag: String,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth().testTag(testTag).clickable(onClick = onClick),
        shape = RoundedCornerShape(8.dp),
        color = if (enabled) HushSoft else Color.White,
        border = androidx.compose.foundation.BorderStroke(1.dp, if (enabled) Hush.copy(alpha = 0.35f) else Line),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 15.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(icon, contentDescription = null, tint = Hush, modifier = Modifier.size(27.dp))
            Spacer(Modifier.size(13.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleMedium, color = Ink)
                Text(detail, style = MaterialTheme.typography.bodyMedium, color = Muted)
            }
            Text(
                if (enabled) "已允许" else "开启",
                style = MaterialTheme.typography.labelLarge,
                color = Hush,
            )
            Icon(Icons.Outlined.ChevronRight, contentDescription = null, tint = Muted)
        }
    }
}

private fun sourceDetail(
    state: HumHumUiState,
    permission: HealthPermission,
    metric: HealthMetric,
): String {
    if (permission !in state.healthPermissions.granted) return "关闭 · 点击后由系统询问权限"
    return when (state.health?.summary?.sourceStates?.get(metric)) {
        HealthSourceState.HEALTH_CONNECT -> "已通过健康连接读取日汇总"
        HealthSourceState.PHONE_STEP_COUNTER -> "已使用本机计步器"
        HealthSourceState.UNAVAILABLE -> "当前设备暂不可用"
        HealthSourceState.DISABLED, null -> "已允许，等待下次同步"
    }
}
