package com.humhum.mobile.health

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.SystemClock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

class PhoneStepDataSource(
    private val context: Context,
    private val sensorManager: SensorManager =
        context.getSystemService(Context.SENSOR_SERVICE) as SensorManager,
    private val checkpoints: PhoneStepCheckpointStore =
        EncryptedStepCheckpointStore(context),
    private val clock: () -> Instant = Instant::now,
    private val elapsedRealtime: () -> Long = SystemClock::elapsedRealtime,
    private val zone: ZoneId = ZoneId.systemDefault(),
) : HealthDataSource {
    override val source = HealthSource.PHONE_STEP_COUNTER

    override suspend fun readDay(
        day: LocalDate,
        metrics: Set<HealthMetric>,
    ): HealthSummary {
        val requested = metrics == setOf(HealthMetric.STEPS)
        val granted = HealthPermissionController.hasActivityRecognitionAccess(
            sdkInt = Build.VERSION.SDK_INT,
            permissionResult = context.checkSelfPermission(ACTIVITY_RECOGNITION_PERMISSION),
        )
        val sensor = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
        val steps = if (requested && granted && sensor != null) {
            readDailyDelta(day, sensor)
        } else {
            null
        }
        return HealthSummary(
            steps = steps,
            restingHeartRate = null,
            sleepMinutes = null,
            capturedAt = if (steps != null) clock() else null,
            sourceStates = HealthMetric.entries.associateWith { metric ->
                when {
                    metric == HealthMetric.STEPS && steps != null -> {
                        HealthSourceState.PHONE_STEP_COUNTER
                    }
                    metric == HealthMetric.STEPS && metric in metrics -> HealthSourceState.UNAVAILABLE
                    else -> HealthSourceState.DISABLED
                }
            },
        )
    }

    private suspend fun readDailyDelta(day: LocalDate, sensor: Sensor): Double? {
        val total = withTimeoutOrNull(SENSOR_TIMEOUT_MILLIS) {
            awaitCounter(sensor)
        } ?: return null
        return PhoneStepTracker(checkpoints, zone).observe(
            day = day,
            cumulativeSteps = total,
            elapsedRealtimeMillis = elapsedRealtime(),
            observedAt = clock(),
        )
    }

    private suspend fun awaitCounter(sensor: Sensor): Double? =
        suspendCancellableCoroutine { continuation ->
            val listener = object : SensorEventListener {
                override fun onSensorChanged(event: SensorEvent) {
                    if (!continuation.isActive) return
                    sensorManager.unregisterListener(this)
                    continuation.resume(event.values.firstOrNull()?.toDouble())
                }

                override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
            }
            continuation.invokeOnCancellation {
                sensorManager.unregisterListener(listener)
            }
            if (!sensorManager.registerListener(
                    listener,
                    sensor,
                    SensorManager.SENSOR_DELAY_NORMAL,
                )
            ) {
                continuation.resume(null)
            }
        }

    companion object {
        private const val SENSOR_TIMEOUT_MILLIS = 2_000L
        private const val ACTIVITY_RECOGNITION_PERMISSION =
            "android.permission.ACTIVITY_RECOGNITION"
    }
}
