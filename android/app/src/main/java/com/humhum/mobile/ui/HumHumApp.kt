package com.humhum.mobile.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.Models
import com.humhum.mobile.app.ConnectionStatus
import com.humhum.mobile.app.HealthPermission
import com.humhum.mobile.app.HumHumUiState
import com.humhum.mobile.ui.components.RoleNavigation
import com.humhum.mobile.ui.components.roleIconFor
import com.humhum.mobile.ui.theme.Canvas
import com.humhum.mobile.ui.theme.HumHumTheme
import com.humhum.mobile.ui.theme.Ink
import com.humhum.mobile.ui.theme.Muted
import com.humhum.mobile.ui.theme.paletteFor

data class HumHumCallbacks(
    val onSelectRole: (MobileRoleDashboard.Role) -> Unit = {},
    val onOpenSettings: () -> Unit = {},
    val onCloseSettings: () -> Unit = {},
    val onRefresh: () -> Unit = {},
    val onRefreshHush: () -> Unit = {},
    val onAdjustToday: () -> Unit = {},
    val onScanPairing: () -> Unit = {},
    val onPastePairing: () -> Unit = {},
    val onManualPair: (String, String, String, String) -> Unit = { _, _, _, _ -> },
    val onDisconnect: () -> Unit = {},
    val onRequestHealthPermission: (HealthPermission) -> Unit = {},
    val onManageHealthPermissions: () -> Unit = {},
    val onBackgroundHealthChanged: (Boolean) -> Unit = {},
    val onMonitorChanged: (Boolean) -> Unit = {},
    val onOpenDeviceCare: () -> Unit = {},
    val onDeleteLocalData: () -> Unit = {},
    val onOpenConversation: (Models.Session) -> Unit = {},
    val onCloseConversation: () -> Unit = {},
    val onResolve: (Models.Session, Models.Action, Boolean) -> Unit = { _, _, _ -> },
    val onSendFollowUp: (Models.Session, String) -> Unit = { _, _ -> },
)

@Composable
fun HumHumApp(
    state: HumHumUiState,
    callbacks: HumHumCallbacks,
    modifier: Modifier = Modifier,
) {
    HumHumTheme {
        Box(
            modifier = modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing),
        ) {
            when {
                state.settingsVisible -> SettingsScreen(state, callbacks, Modifier.fillMaxSize())
                state.scope == null || state.connection == ConnectionStatus.UNPAIRED ||
                    state.connection == ConnectionStatus.SCANNING || state.connection == ConnectionStatus.PAIRING -> {
                    PairingScreen(state, callbacks, Modifier.fillMaxSize())
                }
                else -> CompanionScaffold(state, callbacks, Modifier.fillMaxSize())
            }
        }
    }
}

@Composable
private fun CompanionScaffold(
    state: HumHumUiState,
    callbacks: HumHumCallbacks,
    modifier: Modifier,
) {
    Scaffold(
        modifier = modifier.fillMaxSize(),
        containerColor = Canvas,
        topBar = { CompanionHeader(state, callbacks) },
        bottomBar = {
            RoleNavigation(
                selected = state.selectedRole,
                onSelect = callbacks.onSelectRole,
            )
        },
    ) { padding ->
        when (state.selectedRole) {
            MobileRoleDashboard.Role.HUMI ->
                HumiRoomScreen(state, callbacks, Modifier.padding(padding))
            MobileRoleDashboard.Role.HYPE ->
                HypeRoomScreen(state, Modifier.padding(padding))
            MobileRoleDashboard.Role.HUSH ->
                HushRoomScreen(state, callbacks, Modifier.padding(padding))
            MobileRoleDashboard.Role.HEXA -> HexaScreen(state, callbacks, Modifier.padding(padding))
        }
    }
}

@Composable
private fun CompanionHeader(state: HumHumUiState, callbacks: HumHumCallbacks) {
    val role = state.selectedRole
    val palette = paletteFor(role)
    val canRefresh = role == MobileRoleDashboard.Role.HUSH ||
        role == MobileRoleDashboard.Role.HEXA
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(72.dp)
            .padding(start = 16.dp, end = 8.dp)
            .testTag("companion-header"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Surface(
            modifier = Modifier.size(36.dp),
            color = palette.soft,
            shape = RoundedCornerShape(8.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    roleIconFor(role),
                    contentDescription = null,
                    modifier = Modifier.size(22.dp),
                    tint = palette.accent,
                )
            }
        }
        Spacer(Modifier.size(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                role.displayName(),
                style = MaterialTheme.typography.titleLarge,
                color = Ink,
            )
            Text(
                state.statusMessage,
                style = MaterialTheme.typography.labelMedium,
                color = if (state.connection == ConnectionStatus.OFFLINE) {
                    MaterialTheme.colorScheme.error
                } else {
                    Muted
                },
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (canRefresh) {
            IconButton(
                onClick = if (role == MobileRoleDashboard.Role.HUSH) {
                    callbacks.onRefreshHush
                } else {
                    callbacks.onRefresh
                },
                modifier = Modifier.size(48.dp),
            ) {
                Icon(
                    Icons.Outlined.Refresh,
                    contentDescription = if (role == MobileRoleDashboard.Role.HUSH) "同步消息" else "刷新",
                    tint = if (state.refreshInFlight) palette.accent.copy(alpha = 0.45f) else Ink,
                )
            }
        }
        IconButton(onClick = callbacks.onOpenSettings, modifier = Modifier.size(48.dp)) {
            Icon(Icons.Outlined.Tune, contentDescription = "设置", tint = Color(0xFF222936))
        }
    }
}
