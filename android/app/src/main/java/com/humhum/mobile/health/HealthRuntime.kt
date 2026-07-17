package com.humhum.mobile.health

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

object HealthRuntime {
    private val refreshMutex = Mutex()

    suspend fun refresh(context: Context, trigger: SyncTrigger): HealthUiState =
        refreshMutex.withLock {
            val application = context.applicationContext
            val controller = HealthPermissionController(application)
            val zone = ZoneId.systemDefault()
            val healthConnect = if (
                HealthConnectClient.getSdkStatus(application) == HealthConnectClient.SDK_AVAILABLE
            ) {
                HealthConnectDataSource(HealthConnectClient.getOrCreate(application), zone)
            } else {
                null
            }
            val repository = HealthRepository(
                planProvider = HealthPlanProvider(controller::plan),
                healthConnectSource = healthConnect,
                phoneStepSource = PhoneStepDataSource(application),
                signalSink = QueuedHealthSignalSink(
                    EncryptedHealthQueue(application),
                    AndroidHealthSignalConnectionProvider(application),
                ),
                dayProvider = { LocalDate.now(zone) },
                clock = Instant::now,
                zone = zone,
            )
            repository.refresh(trigger)
        }

    suspend fun reconcileBackgroundSync(context: Context) {
        HealthPermissionController(context.applicationContext).reconcileBackgroundSync()
    }
}
