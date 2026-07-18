package com.humhum.mobile.health

import android.content.Context
import androidx.activity.ComponentActivity
import androidx.health.connect.client.HealthConnectClient
import androidx.lifecycle.lifecycleScope
import com.humhum.mobile.app.HealthPermission
import com.humhum.mobile.app.HumHumAction
import com.humhum.mobile.app.HumHumViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

object HealthActivityBridge {
    @JvmStatic
    fun healthConnectAvailable(context: Context): Boolean =
        HealthConnectClient.getSdkStatus(context.applicationContext) ==
            HealthConnectClient.SDK_AVAILABLE

    @JvmStatic
    fun permissionsFor(permission: HealthPermission): Set<String> =
        HealthPermissionController.permissionsFor(permission.metric())

    @JvmStatic
    fun backgroundPermissions(): Set<String> =
        HealthPermissionController.backgroundPermissions()

    @JvmStatic
    fun refresh(activity: ComponentActivity, viewModel: HumHumViewModel): Job =
        activity.lifecycleScope.launch {
            val plan = HealthPermissionController(activity.applicationContext).plan(SyncTrigger.FOREGROUND)
            val granted = buildSet {
                plan.foregroundMetrics.forEach { metric ->
                    add(metric.permission())
                }
            }
            viewModel.dispatch(
                HumHumAction.HealthPermissionResult(
                    granted = granted,
                    backgroundGranted = HealthBackgroundPreference(activity).isEnabled() &&
                        plan.backgroundMetrics.isNotEmpty(),
                ),
            )
            viewModel.dispatch(
                HumHumAction.HealthUpdated(
                    HealthRuntime.refresh(activity.applicationContext, SyncTrigger.FOREGROUND),
                ),
            )
            HealthRuntime.reconcileBackgroundSync(activity.applicationContext)
        }

    private fun HealthPermission.metric(): HealthMetric = when (this) {
        HealthPermission.STEPS -> HealthMetric.STEPS
        HealthPermission.RESTING_HEART_RATE -> HealthMetric.RESTING_HEART_RATE
        HealthPermission.SLEEP -> HealthMetric.SLEEP
    }

    private fun HealthMetric.permission(): HealthPermission = when (this) {
        HealthMetric.STEPS -> HealthPermission.STEPS
        HealthMetric.RESTING_HEART_RATE -> HealthPermission.RESTING_HEART_RATE
        HealthMetric.SLEEP -> HealthPermission.SLEEP
    }
}
