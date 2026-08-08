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
import androidx.compose.material.icons.outlined.DesktopMac
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.HealthAndSafety
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Language
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import com.humhum.mobile.LanguagePreference
import com.humhum.mobile.R
import com.humhum.mobile.app.ConnectionStatus
import com.humhum.mobile.app.HumHumUiState
import com.humhum.mobile.app.resId
import com.humhum.mobile.app.resolve
import com.humhum.mobile.ui.theme.Humi
import com.humhum.mobile.ui.theme.Ink
import com.humhum.mobile.ui.theme.Line
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
        contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 16.dp, end = 16.dp, bottom = 30.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        item {
            Row(modifier = Modifier.fillMaxWidth().height(64.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = callbacks.onCloseSettings, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = stringResource(R.string.settings_back))
                }
                Column {
                    Text(stringResource(R.string.settings_title), style = MaterialTheme.typography.titleLarge, color = Ink)
                    Text(stringResource(R.string.settings_subtitle), style = MaterialTheme.typography.labelMedium, color = Muted)
                }
            }
        }
        item { LanguageRow() }
        item { SettingsSection(stringResource(R.string.settings_section_connection)) }
        item {
            SettingsRow(
                icon = Icons.Outlined.DesktopMac,
                title = stringResource(R.string.settings_home_mac),
                detail = if (state.connection == ConnectionStatus.CONNECTED) {
                    stringResource(R.string.settings_home_mac_connected)
                } else {
                    state.statusMessage.resolve()
                },
                onClick = callbacks.onDisconnect,
                trailing = if (state.scope == null) stringResource(R.string.settings_not_connected) else stringResource(R.string.settings_connected),
            )
        }
        item { SettingsSection(stringResource(R.string.settings_section_health_privacy)) }
        item {
            SettingsRow(
                icon = Icons.Outlined.HealthAndSafety,
                title = stringResource(R.string.settings_health_sources),
                detail = stringResource(R.string.settings_health_sources_detail),
                onClick = callbacks.onManageHealthPermissions,
                trailing = "${state.healthPermissions.granted.size}/3",
            )
        }
        item {
            SettingsToggle(
                icon = Icons.Outlined.NotificationsActive,
                title = stringResource(R.string.settings_background_health),
                detail = stringResource(R.string.settings_background_health_detail),
                checked = state.healthPermissions.backgroundGranted,
                onChecked = callbacks.onBackgroundHealthChanged,
            )
        }
        item { SettingsSection(stringResource(R.string.settings_section_background)) }
        item {
            SettingsToggle(
                icon = Icons.Outlined.NotificationsActive,
                title = stringResource(R.string.settings_hexa_monitor),
                detail = stringResource(state.monitor.status.resId()),
                checked = state.monitor.enabled,
                onChecked = callbacks.onMonitorChanged,
            )
        }
        item {
            SettingsRow(
                icon = Icons.Outlined.BatteryChargingFull,
                title = stringResource(R.string.settings_battery_autostart),
                detail = if (state.deviceCare.batteryOptimized) stringResource(R.string.settings_battery_recommend) else stringResource(R.string.settings_battery_relaxed),
                onClick = callbacks.onOpenDeviceCare,
                trailing = stringResource(R.string.settings_check),
            )
        }
        item {
            SettingsRow(
                icon = Icons.Outlined.Lock,
                title = stringResource(R.string.settings_local_encryption),
                detail = stringResource(R.string.settings_local_encryption_detail),
                onClick = {},
            )
        }
        item {
            SettingsRow(
                icon = Icons.Outlined.DeleteOutline,
                title = stringResource(R.string.settings_delete_data),
                detail = stringResource(R.string.settings_delete_data_detail),
                onClick = callbacks.onDeleteLocalData,
                trailing = stringResource(R.string.common_delete),
            )
        }
        item { SettingsSection(stringResource(R.string.settings_section_about)) }
        item {
            SettingsRow(
                icon = Icons.Outlined.Info,
                title = stringResource(R.string.settings_about_title),
                detail = stringResource(R.string.settings_about_detail, com.humhum.mobile.BuildConfig.VERSION_NAME),
                onClick = {},
            )
        }
        item {
            Row(
                modifier = Modifier.fillMaxWidth().clickable { diagnosticsOpen = !diagnosticsOpen }.padding(vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(stringResource(R.string.settings_diagnostics), style = MaterialTheme.typography.titleMedium, color = Ink)
                Spacer(Modifier.weight(1f))
                Icon(
                    if (diagnosticsOpen) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                    contentDescription = if (diagnosticsOpen) stringResource(R.string.settings_collapse) else stringResource(R.string.settings_expand),
                    tint = Muted,
                )
            }
        }
        if (diagnosticsOpen) {
            item {
                Text(
                    stringResource(
                        R.string.settings_diagnostics_detail,
                        state.connection.toString(),
                        state.scope ?: stringResource(R.string.settings_scope_none),
                        state.relayRecovered.toString(),
                        state.offlineSnapshot.toString(),
                    ),
                    style = MaterialTheme.typography.bodyMedium,
                    color = Muted,
                    modifier = Modifier.fillMaxWidth().padding(bottom = 18.dp),
                )
            }
        }
    }
}

private fun Context.findActivity(): Activity? {
    var context: Context? = this
    while (context is ContextWrapper) {
        if (context is Activity) return context
        context = context.baseContext
    }
    return null
}

@Composable
private fun LanguageRow() {
    val context = LocalContext.current
    val current = LanguagePreference.getLanguage(context)
    Row(
        modifier = Modifier.fillMaxWidth().testTag("settings-language").padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.Language, contentDescription = null, tint = Humi, modifier = Modifier.size(24.dp))
        Spacer(Modifier.size(13.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(stringResource(R.string.settings_language), style = MaterialTheme.typography.titleMedium, color = Ink)
            Text(stringResource(R.string.settings_language_detail), style = MaterialTheme.typography.bodyMedium, color = Muted)
        }
        LanguageChoice(
            label = stringResource(R.string.settings_language_chinese),
            selected = current == LanguagePreference.CHINESE,
            onClick = { applyLanguage(context, LanguagePreference.CHINESE) },
            tag = "settings-language-zh",
        )
        Spacer(Modifier.size(10.dp))
        LanguageChoice(
            label = stringResource(R.string.settings_language_english),
            selected = current == LanguagePreference.ENGLISH,
            onClick = { applyLanguage(context, LanguagePreference.ENGLISH) },
            tag = "settings-language-en",
        )
    }
}

private fun applyLanguage(context: Context, language: String) {
    if (LanguagePreference.getLanguage(context) == language) return
    LanguagePreference.setLanguage(context, language)
    context.findActivity()?.recreate()
}

@Composable
private fun LanguageChoice(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    tag: String,
) {
    Text(
        label,
        style = MaterialTheme.typography.labelLarge,
        color = if (selected) Humi else Muted,
        modifier = Modifier
            .testTag(tag)
            .clickable(onClick = onClick)
            .padding(horizontal = 6.dp, vertical = 4.dp),
    )
}

@Composable
private fun SettingsSection(title: String) {
    Text(
        title,
        style = MaterialTheme.typography.labelLarge,
        color = Humi,
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
) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = Humi, modifier = Modifier.size(24.dp))
        Spacer(Modifier.size(13.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = Ink)
            Text(detail, style = MaterialTheme.typography.bodyMedium, color = Muted)
        }
        trailing?.let { Text(it, style = MaterialTheme.typography.labelLarge, color = Humi) }
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
        Icon(icon, contentDescription = null, tint = Humi, modifier = Modifier.size(24.dp))
        Spacer(Modifier.size(13.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = Ink)
            Text(detail, style = MaterialTheme.typography.bodyMedium, color = Muted)
        }
        Switch(checked = checked, onCheckedChange = onChecked)
    }
}
