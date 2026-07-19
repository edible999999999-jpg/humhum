package com.humhum.mobile.app

import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.Models
import java.io.Closeable
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class HumHumViewModel @JvmOverloads constructor(
    private val repository: MobileCompanionRepository,
    initialRole: MobileRoleDashboard.Role = MobileRoleDashboard.Role.HUMI,
) : Closeable {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val mutableState = MutableStateFlow(HumHumUiState(selectedRole = initialRole))
    private var pollingJob: Job? = null
    private val pollingGeneration = AtomicLong()

    val state: StateFlow<HumHumUiState> = mutableState.asStateFlow()

    @Synchronized
    fun dispatch(action: HumHumAction) {
        mutableState.value = reduce(mutableState.value, action)
    }

    @JvmOverloads
    fun startPolling(intervalMillis: Long = 10_000L, requestRefresh: () -> Unit) {
        require(intervalMillis > 0) { "Polling interval must be positive" }
        stopPolling()
        val generation = pollingGeneration.incrementAndGet()
        pollingJob = scope.launch {
            while (isActive) {
                delay(intervalMillis)
                if (generation == pollingGeneration.get() &&
                    state.value.scope != null &&
                    state.value.connection != ConnectionStatus.DISCONNECTING
                ) {
                    requestRefresh()
                }
            }
        }
    }

    fun startPolling(intervalMillis: Long, requestRefresh: Runnable) {
        startPolling(intervalMillis) { requestRefresh.run() }
    }

    fun stopPolling() {
        pollingGeneration.incrementAndGet()
        pollingJob?.cancel()
        pollingJob = null
    }

    override fun close() {
        stopPolling()
        scope.cancel()
        repository.close()
    }

    private fun reduce(state: HumHumUiState, action: HumHumAction): HumHumUiState {
        return when (action) {
            HumHumAction.ScanStarted -> state.copy(
                connection = ConnectionStatus.SCANNING,
                connectionBeforeScan = if (state.connection == ConnectionStatus.SCANNING) {
                    state.connectionBeforeScan
                } else {
                    state.connection
                },
                errorMessage = null,
            )
            HumHumAction.ScanCancelled -> state.copy(
                connection = state.connectionBeforeScan ?: ConnectionStatus.UNPAIRED,
                connectionBeforeScan = null,
                errorMessage = null,
            )
            is HumHumAction.PairingInputRejected -> state.copy(
                connection = state.connectionBeforeScan ?: when (state.connection) {
                    ConnectionStatus.SCANNING -> ConnectionStatus.UNPAIRED
                    else -> state.connection
                },
                connectionBeforeScan = null,
                errorMessage = action.message,
            )
            HumHumAction.PairingStarted -> state.copy(
                connection = ConnectionStatus.PAIRING,
                refreshInFlight = false,
                errorMessage = null,
                statusMessage = "正在安全配对",
            )
            is HumHumAction.PairingFailed -> state.copy(
                connection = state.connectionBeforeScan ?: ConnectionStatus.UNPAIRED,
                connectionBeforeScan = null,
                refreshInFlight = false,
                errorMessage = action.message,
                statusMessage = "等待连接",
            )
            is HumHumAction.Connected -> state.copy(
                connection = ConnectionStatus.CONNECTED,
                connectionBeforeScan = null,
                scope = action.scope,
                sessions = sanitizeSessions(state.sessions, action.scope),
                refreshInFlight = false,
                offlineSnapshot = false,
                relayRecovered = false,
                errorMessage = null,
                statusMessage = "正在同步",
            )
            is HumHumAction.ConnectionRestored -> state.copy(
                connection = ConnectionStatus.CONNECTED,
                connectionBeforeScan = null,
                scope = action.scope,
                sessions = sanitizeSessions(state.sessions, action.scope),
                refreshInFlight = false,
                offlineSnapshot = false,
                errorMessage = action.message,
                statusMessage = action.message,
            )
            is HumHumAction.SelectRole -> state.copy(
                selectedRole = action.role,
                conversation = if (action.role == MobileRoleDashboard.Role.HEXA) {
                    state.conversation
                } else {
                    ConversationDisclosure()
                },
            )
            is HumHumAction.RefreshRequested -> {
                if (state.scope == null || state.refreshInFlight) state else state.copy(
                    refreshInFlight = true,
                    relayRecovered = false,
                    errorMessage = null,
                    statusMessage = if (action.userInitiated) "正在刷新" else state.statusMessage,
                )
            }
            HumHumAction.RefreshCancelled -> state.copy(
                refreshInFlight = false,
                statusMessage = if (state.connection == ConnectionStatus.CONNECTED) {
                    "已连接"
                } else {
                    state.statusMessage
                },
            )
            is HumHumAction.SessionsLoaded -> state.copy(
                connection = ConnectionStatus.CONNECTED,
                sessions = sanitizeSessions(action.sessions, state.scope),
                refreshInFlight = false,
                offlineSnapshot = false,
                relayRecovered = action.viaRelay,
                errorMessage = null,
                statusMessage = if (action.viaRelay) "远程连接 · 刚刚同步" else "刚刚同步",
            )
            is HumHumAction.RefreshFailed -> state.copy(
                connection = ConnectionStatus.OFFLINE,
                sessions = emptyList(),
                conversation = ConversationDisclosure(),
                pendingActions = emptySet(),
                refreshInFlight = false,
                offlineSnapshot = false,
                errorMessage = action.message,
                statusMessage = "电脑离线",
            )
            is HumHumAction.OfflineSnapshotLoaded -> state.copy(
                connection = ConnectionStatus.OFFLINE,
                sessions = sanitizeSessions(action.sessions, state.scope),
                refreshInFlight = false,
                offlineSnapshot = true,
                relayRecovered = false,
                errorMessage = null,
                statusMessage = action.ageCopy,
            )
            is HumHumAction.RelayRecovered -> state.copy(
                connection = ConnectionStatus.CONNECTED,
                sessions = sanitizeSessions(action.sessions, state.scope),
                refreshInFlight = false,
                offlineSnapshot = false,
                relayRecovered = true,
                errorMessage = null,
                statusMessage = "远程连接 · 刚刚同步",
            )
            is HumHumAction.OpenConversation -> {
                val canRead = state.sessions.any {
                    it.id() == action.sessionId && it.canReadConversation()
                }
                if (!canRead) state else state.copy(
                    conversation = ConversationDisclosure(
                        sessionId = action.sessionId,
                        loading = true,
                    ),
                )
            }
            is HumHumAction.ConversationLoaded -> {
                if (state.conversation.sessionId != action.sessionId) state else state.copy(
                    conversation = ConversationDisclosure(
                        sessionId = action.sessionId,
                        messages = action.messages.toList(),
                    ),
                )
            }
            is HumHumAction.ConversationFailed -> {
                if (state.conversation.sessionId != action.sessionId) state else state.copy(
                    conversation = state.conversation.copy(
                        loading = false,
                        error = action.message,
                    ),
                )
            }
            HumHumAction.CloseConversation -> state.copy(
                conversation = ConversationDisclosure(),
            )
            is HumHumAction.ApprovalStarted -> addPendingControlAction(
                state,
                PendingAction(PendingActionKind.APPROVAL, action.sessionId, action.actionId),
                state.sessions.any { session ->
                    session.id() == action.sessionId &&
                        session.actions().any { it.id() == action.actionId }
                },
            )
            is HumHumAction.ApprovalFinished -> state.copy(
                pendingActions = state.pendingActions - PendingAction(
                    PendingActionKind.APPROVAL,
                    action.sessionId,
                    action.actionId,
                ),
            )
            is HumHumAction.FollowUpStarted -> addPendingControlAction(
                state,
                PendingAction(PendingActionKind.FOLLOW_UP, action.sessionId),
                state.sessions.any {
                    it.id() == action.sessionId && it.canMessage()
                },
            )
            is HumHumAction.FollowUpSucceeded -> state.copy(
                pendingActions = state.pendingActions - PendingAction(
                    PendingActionKind.FOLLOW_UP,
                    action.sessionId,
                ),
                lastSuccessfulFollowUpSessionId = action.sessionId,
                followUpSuccessRevision = state.followUpSuccessRevision + 1,
            )
            is HumHumAction.FollowUpFailed -> state.copy(
                pendingActions = state.pendingActions - PendingAction(
                    PendingActionKind.FOLLOW_UP,
                    action.sessionId,
                ),
            )
            is HumHumAction.MonitorChanged -> state.copy(
                monitor = MonitorUiState(
                    enabled = action.enabled,
                    permissionRequired = action.permissionRequired,
                    status = when {
                        action.permissionRequired -> "需要通知权限"
                        action.enabled -> "正在监控这台电脑"
                        else -> "已关闭"
                    },
                ),
            )
            is HumHumAction.DeviceCareChanged -> state.copy(
                deviceCare = DeviceCareUiState(
                    batteryOptimized = action.batteryOptimized,
                    autostartAvailable = action.autostartAvailable,
                    pushReady = action.pushReady,
                ),
            )
            is HumHumAction.HealthPermissionResult -> state.copy(
                healthPermissions = HealthPermissionState(
                    granted = action.granted.toSet(),
                    backgroundGranted = action.backgroundGranted,
                ),
            )
            is HumHumAction.HealthUpdated -> state.copy(health = action.health)
            is HumHumAction.PersonalContextCapabilityChanged -> state.copy(
                personalContextAuthorized = action.authorized,
                personalContext = if (action.authorized) state.personalContext else null,
                personalContextFromCache = false,
                personalContextMessage = if (action.authorized) null else "电脑未授权个人上下文",
            )
            is HumHumAction.PersonalContextLoaded -> state.copy(
                personalContext = action.context,
                personalContextAuthorized = true,
                personalContextFromCache = action.fromCache,
                personalContextMessage = if (action.fromCache) "显示 24 小时内的加密缓存" else null,
            )
            is HumHumAction.PersonalContextFailed -> state.copy(
                personalContextMessage = action.message,
            )
            is HumHumAction.StatusChanged -> state.copy(statusMessage = action.message)
            HumHumAction.OpenSettings -> state.copy(settingsVisible = true)
            HumHumAction.CloseSettings -> state.copy(settingsVisible = false)
            HumHumAction.DisconnectStarted -> state.copy(
                connection = ConnectionStatus.DISCONNECTING,
                refreshInFlight = false,
                pendingActions = emptySet(),
                conversation = ConversationDisclosure(),
                statusMessage = "正在断开连接",
            )
            HumHumAction.Disconnected -> HumHumUiState(
                selectedRole = state.selectedRole,
                deviceCare = state.deviceCare,
                healthPermissions = state.healthPermissions,
            )
        }
    }

    private fun addPendingControlAction(
        state: HumHumUiState,
        pendingAction: PendingAction,
        sessionAllowsAction: Boolean,
    ): HumHumUiState {
        if (!state.canControl || !sessionAllowsAction) return state
        return state.copy(pendingActions = state.pendingActions + pendingAction)
    }

    private fun sanitizeSessions(
        sessions: List<Models.Session>,
        scope: Models.Scope?,
    ): List<Models.Session> {
        if (scope == Models.Scope.CONTROL) return sessions.toList()
        return sessions.map { session ->
            Models.Session(
                session.id(),
                session.agent(),
                session.project(),
                session.status(),
                session.lastActivityAt(),
                session.needsAttention(),
                false,
                session.canReadConversation(),
                emptyList(),
            )
        }
    }
}
