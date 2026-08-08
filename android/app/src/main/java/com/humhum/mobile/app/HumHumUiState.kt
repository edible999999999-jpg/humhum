package com.humhum.mobile.app

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.Models
import com.humhum.mobile.R
import com.humhum.mobile.health.HealthUiState

/**
 * Language-agnostic identifiers for the static status copy that the reducer bakes into UI
 * state. The reducer only knows which semantic state applies; the actual localized string is
 * resolved in the Compose layer via [resId]/[resolve], so the same state renders correctly in
 * every configured locale.
 */
enum class StatusKey {
    SECURE_PAIRING,
    WAITING_CONNECTION,
    SYNCING,
    REFRESHING,
    CONNECTED,
    SYNCED,
    SYNCED_REMOTE,
    OFFLINE,
    DISCONNECTING,
    MONITOR_NEEDS_NOTIFICATION,
    MONITOR_WATCHING,
    MONITOR_OFF,
    PERSONAL_CONTEXT_UNAUTHORIZED,
    PERSONAL_CONTEXT_CACHED,
    FOLLOW_UP_QUEUED,
}

/**
 * Status copy carried through UI state. Static states use [Res] (a semantic key resolved at
 * render time); values that are only known at runtime and are already localized at the dispatch
 * source use [Literal].
 */
sealed interface StatusText {
    data class Res(val key: StatusKey) : StatusText
    data class Literal(val text: String) : StatusText
}

@StringRes
fun StatusKey.resId(): Int = when (this) {
    StatusKey.SECURE_PAIRING -> R.string.status_secure_pairing
    StatusKey.WAITING_CONNECTION -> R.string.status_waiting_connection
    StatusKey.SYNCING -> R.string.status_syncing
    StatusKey.REFRESHING -> R.string.status_refreshing
    StatusKey.CONNECTED -> R.string.status_connected
    StatusKey.SYNCED -> R.string.status_synced
    StatusKey.SYNCED_REMOTE -> R.string.status_synced_remote
    StatusKey.OFFLINE -> R.string.status_offline
    StatusKey.DISCONNECTING -> R.string.status_disconnecting
    StatusKey.MONITOR_NEEDS_NOTIFICATION -> R.string.status_monitor_needs_notification
    StatusKey.MONITOR_WATCHING -> R.string.status_monitor_watching
    StatusKey.MONITOR_OFF -> R.string.status_monitor_off
    StatusKey.PERSONAL_CONTEXT_UNAUTHORIZED -> R.string.status_personal_context_unauthorized
    StatusKey.PERSONAL_CONTEXT_CACHED -> R.string.status_personal_context_cached
    StatusKey.FOLLOW_UP_QUEUED -> R.string.status_follow_up_queued
}

@Composable
fun StatusText.resolve(): String = when (this) {
    is StatusText.Res -> stringResource(key.resId())
    is StatusText.Literal -> text
}

/** Non-Composable resolver for the legacy Java View layer, which has a [android.content.Context]. */
fun StatusText.resolve(context: android.content.Context): String = when (this) {
    is StatusText.Res -> context.getString(key.resId())
    is StatusText.Literal -> text
}

enum class ConnectionStatus {
    UNPAIRED,
    SCANNING,
    PAIRING,
    CONNECTED,
    OFFLINE,
    DISCONNECTING,
}

enum class HealthPermission {
    STEPS,
    RESTING_HEART_RATE,
    SLEEP,
}

data class ConversationDisclosure(
    val sessionId: String? = null,
    val messages: List<Models.ConversationMessage> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
)

enum class PendingActionKind {
    APPROVAL,
    FOLLOW_UP,
}

data class PendingAction(
    val kind: PendingActionKind,
    val sessionId: String,
    val actionId: String = "",
)

data class MonitorUiState(
    val enabled: Boolean = false,
    val permissionRequired: Boolean = false,
    val status: StatusKey = StatusKey.MONITOR_OFF,
)

data class DeviceCareUiState(
    val batteryOptimized: Boolean = true,
    val autostartAvailable: Boolean = false,
    val pushReady: Boolean = false,
)

data class HealthPermissionState(
    val granted: Set<HealthPermission> = emptySet(),
    val backgroundGranted: Boolean = false,
)

data class HumHumUiState(
    val connection: ConnectionStatus = ConnectionStatus.UNPAIRED,
    val connectionBeforeScan: ConnectionStatus? = null,
    val scope: Models.Scope? = null,
    val selectedRole: MobileRoleDashboard.Role = MobileRoleDashboard.Role.HUMI,
    val sessions: List<Models.Session> = emptyList(),
    val conversation: ConversationDisclosure = ConversationDisclosure(),
    val pendingActions: Set<PendingAction> = emptySet(),
    val lastSuccessfulFollowUpSessionId: String? = null,
    val followUpSuccessRevision: Long = 0,
    val followUpFeedback: Map<String, StatusText> = emptyMap(),
    val monitor: MonitorUiState = MonitorUiState(),
    val deviceCare: DeviceCareUiState = DeviceCareUiState(),
    val health: HealthUiState? = null,
    val healthPermissions: HealthPermissionState = HealthPermissionState(),
    val personalContext: Models.PersonalContext? = null,
    val personalContextAuthorized: Boolean = false,
    val personalContextFromCache: Boolean = false,
    val personalContextMessage: StatusText? = null,
    val settingsVisible: Boolean = false,
    val refreshInFlight: Boolean = false,
    val offlineSnapshot: Boolean = false,
    val relayRecovered: Boolean = false,
    val statusMessage: StatusText = StatusText.Res(StatusKey.WAITING_CONNECTION),
    val errorMessage: String? = null,
) {
    val canControl: Boolean
        get() = scope == Models.Scope.CONTROL &&
            (connection == ConnectionStatus.CONNECTED || connection == ConnectionStatus.OFFLINE)
}
