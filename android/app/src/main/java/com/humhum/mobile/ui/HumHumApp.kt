package com.humhum.mobile.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.Models
import com.humhum.mobile.app.ConnectionStatus
import com.humhum.mobile.app.HealthPermission
import com.humhum.mobile.app.HumHumUiState
import com.humhum.mobile.ui.components.RoleNavigation
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
    val onAdjustToday: () -> Unit = {},
    val onScanPairing: () -> Unit = {},
    val onPastePairing: () -> Unit = {},
    val onManualPair: (String, String, String, String) -> Unit = { _, _, _, _ -> },
    val onDisconnect: () -> Unit = {},
    val onRequestHealthPermission: (HealthPermission) -> Unit = {},
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
        when {
            state.settingsVisible -> SettingsScreen(state, callbacks, modifier)
            state.scope == null || state.connection == ConnectionStatus.UNPAIRED ||
                state.connection == ConnectionStatus.SCANNING || state.connection == ConnectionStatus.PAIRING -> {
                PairingScreen(state, callbacks, modifier)
            }
            else -> CompanionScaffold(state, callbacks, modifier)
        }
    }
}

@Composable
private fun CompanionScaffold(
    state: HumHumUiState,
    callbacks: HumHumCallbacks,
    modifier: Modifier,
) {
    val palette = paletteFor(state.selectedRole)
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
            MobileRoleDashboard.Role.HUMI -> LivingSignalsScreen(
                state = state,
                onAdjustToday = callbacks.onAdjustToday,
                modifier = Modifier.padding(padding),
            )
            MobileRoleDashboard.Role.HYPE -> HypeScreen(state, Modifier.padding(padding))
            MobileRoleDashboard.Role.HUSH -> HushSourcesScreen(
                state = state,
                onRequestPermission = callbacks.onRequestHealthPermission,
                modifier = Modifier.padding(padding),
            )
            MobileRoleDashboard.Role.HEXA -> HexaScreen(state, callbacks, Modifier.padding(padding))
        }
    }
}

@Composable
private fun CompanionHeader(state: HumHumUiState, callbacks: HumHumCallbacks) {
    Row(
        modifier = Modifier.fillMaxWidth().height(68.dp).padding(start = 20.dp, end = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("HUMHUM", style = MaterialTheme.typography.titleLarge, color = paletteFor(state.selectedRole).accent)
        Spacer(Modifier.size(10.dp))
        Text(state.selectedRole.displayName(), style = MaterialTheme.typography.bodyLarge, color = Ink)
        Spacer(Modifier.weight(1f))
        Text(
            state.statusMessage,
            style = MaterialTheme.typography.labelMedium,
            color = if (state.connection == ConnectionStatus.OFFLINE) MaterialTheme.colorScheme.error else Muted,
            maxLines = 1,
        )
        IconButton(onClick = callbacks.onOpenSettings, modifier = Modifier.size(48.dp)) {
            Icon(Icons.Outlined.Settings, contentDescription = "设置", tint = Ink)
        }
    }
}
