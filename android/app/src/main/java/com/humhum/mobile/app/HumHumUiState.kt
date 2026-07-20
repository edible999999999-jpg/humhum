package com.humhum.mobile.app

import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.Models
import com.humhum.mobile.health.HealthUiState

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
    val status: String = "已关闭",
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
    val monitor: MonitorUiState = MonitorUiState(),
    val deviceCare: DeviceCareUiState = DeviceCareUiState(),
    val health: HealthUiState? = null,
    val healthPermissions: HealthPermissionState = HealthPermissionState(),
    val personalContext: Models.PersonalContext? = null,
    val personalContextAuthorized: Boolean = false,
    val personalContextFromCache: Boolean = false,
    val personalContextMessage: String? = null,
    val settingsVisible: Boolean = false,
    val refreshInFlight: Boolean = false,
    val offlineSnapshot: Boolean = false,
    val relayRecovered: Boolean = false,
    val statusMessage: String = "等待连接",
    val errorMessage: String? = null,
) {
    val canControl: Boolean
        get() = scope == Models.Scope.CONTROL &&
            (connection == ConnectionStatus.CONNECTED || connection == ConnectionStatus.OFFLINE)

    val canActOnSessions: Boolean
        get() = canControl && !offlineSnapshot
}
