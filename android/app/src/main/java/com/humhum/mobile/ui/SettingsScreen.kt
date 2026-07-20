package com.humhum.mobile.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BatteryChargingFull
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.HealthAndSafety
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.humhum.mobile.app.HumHumUiState
import com.humhum.mobile.ui.theme.Ink
import com.humhum.mobile.ui.theme.Muted

@Composable
fun SettingsScreen(
    state: HumHumUiState,
    callbacks: HumHumCallbacks,
    modifier: Modifier = Modifier,
) {
    var diagnosticsOpen by remember { mutableStateOf(false) }
    LazyColumn(
        modifier = modifier.fillMaxSize().testTag("settings-screen"),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 20.dp, end = 20.dp, bottom = 30.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        item {
            Row(modifier = Modifier.fillMaxWidth().height(64.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = callbacks.onCloseSettings, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "返回")
                }
                Text("设置", style = MaterialTheme.typography.headlineMedium, color = Ink)
            }
        }
        item { SettingsSection("Mac") }
        item {
            SettingsRow(
                icon = Icons.Outlined.Link,
                title = "电脑连接",
                detail = state.statusMessage,
                onClick = callbacks.onDisconnect,
                trailing = if (state.scope == null) "未连接" else "断开",
            )
        }
        item { SettingsSection("健康权限") }
        item {
            SettingsRow(
                icon = Icons.Outlined.HealthAndSafety,
                title = "步数、静息心率与睡眠",
                detail = "已允许 ${state.healthPermissions.granted.size}/3 项",
                onClick = callbacks.onManageHealthPermissions,
                trailing = "管理",
            )
        }
        item {
            SettingsToggle(
                icon = Icons.Outlined.NotificationsActive,
                title = "后台健康同步",
                detail = "每 6 小时尝试一次，仅同步日汇总",
                checked = state.healthPermissions.backgroundGranted,
                onChecked = callbacks.onBackgroundHealthChanged,
            )
        }
        item { SettingsSection("后台可靠性") }
        item {
            SettingsToggle(
                icon = Icons.Outlined.NotificationsActive,
                title = "Hexa 后台监控",
                detail = state.monitor.status,
                checked = state.monitor.enabled,
                onChecked = callbacks.onMonitorChanged,
            )
        }
        item {
            SettingsRow(
                icon = Icons.Outlined.BatteryChargingFull,
                title = "电池与自启动",
                detail = if (state.deviceCare.batteryOptimized) "建议允许后台运行" else "后台限制已放宽",
                onClick = callbacks.onOpenDeviceCare,
                trailing = "检查",
            )
        }
        item { SettingsSection("隐私") }
        item {
            SettingsRow(
                icon = Icons.Outlined.Lock,
                title = "本机加密",
                detail = "健康待传数据与会话快照均加密保存",
                onClick = {},
            )
        }
        item {
            SettingsRow(
                icon = Icons.Outlined.DeleteOutline,
                title = "删除手机上的 HUMHUM 数据",
                detail = "清除连接、加密队列和离线快照",
                onClick = callbacks.onDeleteLocalData,
                trailing = "删除",
                destructive = true,
            )
        }
        item { SettingsSection("关于") }
        item {
            SettingsRow(
                icon = Icons.Outlined.Info,
                title = "HUMHUM for Android",
                detail = "版本 ${com.humhum.mobile.BuildConfig.VERSION_NAME}",
                onClick = {},
            )
        }
        item {
            Row(
                modifier = Modifier.fillMaxWidth().clickable { diagnosticsOpen = !diagnosticsOpen }.padding(vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("高级诊断", style = MaterialTheme.typography.titleMedium, color = Ink)
                Spacer(Modifier.weight(1f))
                Icon(
                    if (diagnosticsOpen) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                    contentDescription = if (diagnosticsOpen) "收起" else "展开",
                    tint = Muted,
                )
            }
        }
        if (diagnosticsOpen) {
            item {
                Text(
                    "连接状态：${state.connection}\n权限范围：${state.scope ?: "none"}\n远程恢复：${state.relayRecovered}\n离线快照：${state.offlineSnapshot}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Muted,
                    modifier = Modifier.fillMaxWidth().padding(bottom = 18.dp),
                )
            }
        }
    }
}

@Composable
private fun SettingsSection(title: String) {
    Text(
        title,
        style = MaterialTheme.typography.labelLarge,
        color = Muted,
        modifier = Modifier.padding(top = 14.dp, bottom = 3.dp),
    )
}

@Composable
private fun SettingsRow(
    icon: ImageVector,
    title: String,
    detail: String,
    onClick: () -> Unit,
    trailing: String? = null,
    destructive: Boolean = false,
) {
    val actionColor = if (destructive) MaterialTheme.colorScheme.error else Ink
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = if (destructive) actionColor else Muted, modifier = Modifier.size(24.dp))
        Spacer(Modifier.size(13.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = Ink)
            Text(detail, style = MaterialTheme.typography.bodyMedium, color = Muted)
        }
        trailing?.let { Text(it, style = MaterialTheme.typography.labelLarge, color = actionColor) }
        if (trailing != null) Icon(Icons.Outlined.ChevronRight, contentDescription = null, tint = Muted)
    }
}

@Composable
private fun SettingsToggle(
    icon: ImageVector,
    title: String,
    detail: String,
    checked: Boolean,
    onChecked: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = Muted, modifier = Modifier.size(24.dp))
        Spacer(Modifier.size(13.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = Ink)
            Text(detail, style = MaterialTheme.typography.bodyMedium, color = Muted)
        }
        Switch(checked = checked, onCheckedChange = onChecked)
    }
}
