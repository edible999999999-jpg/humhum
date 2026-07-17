package com.humhum.mobile.health

import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorManager
import android.os.Build
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import java.time.Duration
import java.util.concurrent.TimeUnit

data class HealthPermissionSnapshot(
    val healthConnectAvailable: Boolean,
    val backgroundFeatureAvailable: Boolean,
    val stepSensorAvailable: Boolean,
    val activityRecognitionGranted: Boolean,
    val grantedHealthPermissions: Set<String>,
)

fun interface HealthPermissionSnapshotProvider {
    suspend fun snapshot(): HealthPermissionSnapshot
}

interface HealthBackgroundScheduler {
    fun schedule()
    fun cancel()
}

class HealthPermissionController internal constructor(
    private val snapshotProvider: HealthPermissionSnapshotProvider,
    private val scheduler: HealthBackgroundScheduler,
) {
    constructor(context: Context) : this(
        snapshotProvider = AndroidHealthPermissionSnapshotProvider(context.applicationContext),
        scheduler = WorkManagerHealthBackgroundScheduler(context.applicationContext),
    )

    suspend fun plan(trigger: SyncTrigger): HealthSourcePlan {
        val snapshot = snapshotProvider.snapshot()
        val grants = if (snapshot.healthConnectAvailable) {
            HealthMetric.entries.filterTo(linkedSetOf()) { metric ->
                permissionsFor(metric).all(snapshot.grantedHealthPermissions::contains)
            }
        } else if (snapshot.stepSensorAvailable && snapshot.activityRecognitionGranted) {
            setOf(HealthMetric.STEPS)
        } else {
            emptySet()
        }
        val backgroundGranted = snapshot.healthConnectAvailable &&
            snapshot.backgroundFeatureAvailable &&
            backgroundPermissions().all(snapshot.grantedHealthPermissions::contains)
        return HealthSourcePolicy.plan(
            healthConnectAvailable = snapshot.healthConnectAvailable,
            stepSensorAvailable = snapshot.stepSensorAvailable &&
                snapshot.activityRecognitionGranted,
            grants = grants,
            backgroundGranted = backgroundGranted,
        )
    }

    suspend fun reconcileBackgroundSync() {
        val snapshot = snapshotProvider.snapshot()
        val hasMetricGrant = HealthMetric.entries.any { metric ->
            permissionsFor(metric).all(snapshot.grantedHealthPermissions::contains)
        }
        val enabled = snapshot.healthConnectAvailable &&
            snapshot.backgroundFeatureAvailable &&
            hasMetricGrant &&
            backgroundPermissions().all(snapshot.grantedHealthPermissions::contains)
        if (enabled) scheduler.schedule() else scheduler.cancel()
    }

    companion object {
        fun permissionsFor(metric: HealthMetric): Set<String> = setOf(
            when (metric) {
                HealthMetric.STEPS -> HealthPermission.getReadPermission(StepsRecord::class)
                HealthMetric.RESTING_HEART_RATE -> {
                    HealthPermission.getReadPermission(RestingHeartRateRecord::class)
                }
                HealthMetric.SLEEP -> {
                    HealthPermission.getReadPermission(SleepSessionRecord::class)
                }
            },
        )

        fun backgroundPermissions(): Set<String> = setOf(
            HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND,
        )

        internal fun hasActivityRecognitionAccess(
            sdkInt: Int,
            permissionResult: Int,
        ): Boolean = sdkInt < Build.VERSION_CODES.Q ||
            permissionResult == PackageManager.PERMISSION_GRANTED
    }
}

private class AndroidHealthPermissionSnapshotProvider(
    private val context: Context,
) : HealthPermissionSnapshotProvider {
    override suspend fun snapshot(): HealthPermissionSnapshot {
        val available = HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE
        val client = if (available) HealthConnectClient.getOrCreate(context) else null
        val granted = client?.permissionController?.getGrantedPermissions().orEmpty()
        val backgroundAvailable = client?.features?.getFeatureStatus(
            HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND,
        ) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE
        val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        return HealthPermissionSnapshot(
            healthConnectAvailable = available,
            backgroundFeatureAvailable = backgroundAvailable,
            stepSensorAvailable = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null,
            activityRecognitionGranted = HealthPermissionController.hasActivityRecognitionAccess(
                sdkInt = Build.VERSION.SDK_INT,
                permissionResult = context.checkSelfPermission(ACTIVITY_RECOGNITION_PERMISSION),
            ),
            grantedHealthPermissions = granted,
        )
    }

    companion object {
        private const val ACTIVITY_RECOGNITION_PERMISSION =
            "android.permission.ACTIVITY_RECOGNITION"
    }
}

class WorkManagerHealthBackgroundScheduler(
    context: Context,
) : HealthBackgroundScheduler {
    private val workManager = WorkManager.getInstance(context)

    override fun schedule() {
        workManager.enqueueUniquePeriodicWork(
            UNIQUE_WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            workRequest(),
        )
    }

    override fun cancel() {
        workManager.cancelUniqueWork(UNIQUE_WORK_NAME)
    }

    companion object {
        const val UNIQUE_WORK_NAME = "humhum-health-summary-sync"

        internal fun workRequest(): PeriodicWorkRequest {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            return PeriodicWorkRequest.Builder(
                HealthSyncWorker::class.java,
                6L,
                TimeUnit.HOURS,
            ).setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Duration.ofSeconds(30))
                .build()
        }
    }
}
