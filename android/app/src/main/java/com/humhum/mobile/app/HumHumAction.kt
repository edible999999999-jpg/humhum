package com.humhum.mobile.app

import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.Models
import com.humhum.mobile.health.HealthUiState

sealed interface HumHumAction {
    data object ScanStarted : HumHumAction
    data object ScanCancelled : HumHumAction
    data class PairingInputRejected(val message: String) : HumHumAction
    data object PairingStarted : HumHumAction
    data class PairingFailed(val message: String) : HumHumAction
    data class Connected(val scope: Models.Scope) : HumHumAction
    data class ConnectionRestored(
        val scope: Models.Scope,
        val message: String,
    ) : HumHumAction
    data class SelectRole(val role: MobileRoleDashboard.Role) : HumHumAction
    data class RefreshRequested(val userInitiated: Boolean) : HumHumAction
    data object RefreshCancelled : HumHumAction
    data class SessionsLoaded(
        val sessions: List<Models.Session>,
        val viaRelay: Boolean,
    ) : HumHumAction
    data class RefreshFailed(val message: String) : HumHumAction
    data class OfflineSnapshotLoaded(
        val sessions: List<Models.Session>,
        val ageCopy: String,
    ) : HumHumAction
    data class RelayRecovered(val sessions: List<Models.Session>) : HumHumAction
    data class OpenConversation(val sessionId: String) : HumHumAction
    data class ConversationLoaded(
        val sessionId: String,
        val messages: List<Models.ConversationMessage>,
    ) : HumHumAction
    data class ConversationFailed(val sessionId: String, val message: String) : HumHumAction
    data object CloseConversation : HumHumAction
    data class ApprovalStarted(val sessionId: String, val actionId: String) : HumHumAction
    data class ApprovalFinished(val sessionId: String, val actionId: String) : HumHumAction
    data class FollowUpStarted(val sessionId: String) : HumHumAction
    data class FollowUpSucceeded(val sessionId: String) : HumHumAction
    data class FollowUpFailed(val sessionId: String) : HumHumAction
    data class MonitorChanged(
        val enabled: Boolean,
        val permissionRequired: Boolean,
    ) : HumHumAction
    data class DeviceCareChanged(
        val batteryOptimized: Boolean,
        val autostartAvailable: Boolean,
        val pushReady: Boolean,
    ) : HumHumAction
    data class HealthPermissionResult(
        val granted: Set<HealthPermission>,
        val backgroundGranted: Boolean,
    ) : HumHumAction
    data class HealthUpdated(val health: HealthUiState) : HumHumAction
    data class PersonalContextCapabilityChanged(val authorized: Boolean) : HumHumAction
    data class PersonalContextLoaded(
        val context: Models.PersonalContext,
        val fromCache: Boolean,
    ) : HumHumAction
    data class PersonalContextFailed(val message: String) : HumHumAction
    data class StatusChanged(val message: String) : HumHumAction
    data object OpenSettings : HumHumAction
    data object CloseSettings : HumHumAction
    data object DisconnectStarted : HumHumAction
    data object Disconnected : HumHumAction
}
