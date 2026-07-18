package com.humhum.mobile.ui

import android.app.Activity
import android.view.WindowManager
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.humhum.mobile.app.HumHumUiState
import kotlinx.coroutines.flow.StateFlow

object HumHumComposeHost {
    @JvmStatic
    fun create(
        activity: Activity,
        state: StateFlow<HumHumUiState>,
        actions: HumHumActivityActions,
    ): ComposeView = ComposeView(activity).apply {
        setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
        setContent {
            val current by state.collectAsStateWithLifecycle()
            ConversationWindowPrivacy(activity, current.conversation.sessionId != null)
            HumHumApp(
                state = current,
                callbacks = HumHumCallbacks(
                    onSelectRole = actions::selectRole,
                    onOpenSettings = actions::openSettings,
                    onCloseSettings = actions::closeSettings,
                    onRefresh = actions::refresh,
                    onAdjustToday = actions::adjustToday,
                    onScanPairing = actions::scanPairing,
                    onPastePairing = actions::pastePairing,
                    onManualPair = actions::manualPair,
                    onDisconnect = actions::disconnect,
                    onRequestHealthPermission = actions::requestHealthPermission,
                    onBackgroundHealthChanged = actions::setBackgroundHealth,
                    onMonitorChanged = actions::setMonitor,
                    onOpenDeviceCare = actions::openDeviceCare,
                    onDeleteLocalData = actions::deleteLocalData,
                    onOpenConversation = actions::openConversation,
                    onCloseConversation = actions::closeConversation,
                    onResolve = actions::resolve,
                    onSendFollowUp = actions::sendFollowUp,
                ),
            )
        }
    }
}

@androidx.compose.runtime.Composable
private fun ConversationWindowPrivacy(activity: Activity, protected: Boolean) {
    DisposableEffect(protected) {
        if (protected) {
            activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        } else {
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
        onDispose {
            if (protected) activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }
}
